import type { Express } from "express";
import OpenAI from "openai";
import { PDFParse, VerbosityLevel } from "pdf-parse";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { Readable } from "stream";
import * as fs from "fs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from "@aws-sdk/client-textract";
import { ObjectStorageService } from "./replit_integrations/object_storage/objectStorage";
import { s3Client, S3FileRef } from "./replit_integrations/object_storage/s3Client";
import { log } from "./index";

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "us-east-1" });

async function extractTextWithTextract(bucketName: string, objectKey: string): Promise<string> {
  const startRes = await textractClient.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: { S3Object: { Bucket: bucketName, Name: objectKey } },
    })
  );
  const jobId = startRes.JobId!;

  // Poll up to 90 s (18 × 5 s)
  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const getRes = await textractClient.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId })
    );

    if (getRes.JobStatus === "FAILED") {
      throw new Error(`Textract job failed: ${getRes.StatusMessage}`);
    }

    if (getRes.JobStatus === "SUCCEEDED") {
      let blocks = getRes.Blocks ?? [];
      let nextToken = getRes.NextToken;
      while (nextToken) {
        const page = await textractClient.send(
          new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken })
        );
        blocks = blocks.concat(page.Blocks ?? []);
        nextToken = page.NextToken;
      }

      return blocks
        .filter((b) => b.BlockType === "LINE")
        .sort((a, b) => {
          if ((a.Page ?? 0) !== (b.Page ?? 0)) return (a.Page ?? 0) - (b.Page ?? 0);
          return (a.Geometry?.BoundingBox?.Top ?? 0) - (b.Geometry?.BoundingBox?.Top ?? 0);
        })
        .map((b) => b.Text ?? "")
        .join("\n");
    }
  }

  throw new Error("Textract job timed out after 90 s");
}

function makePerplexityClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: "https://api.perplexity.ai",
  });
}

const DOC_TYPES = [
  "Home Inspection Report",
  "Pest Inspection Report",
  "Roof Inspection Report",
  "Electrical Inspection Report",
  "Plumbing Inspection Report",
  "Foundation Inspection Report",
  "HVAC Inspection Report",
  "Permit Report",
  "Disclosure Report",
  "Appraisal Report",
  "Other",
];

const SINGLE_CALL_LIMIT = 120_000;
const CHUNK_SIZE = 100_000;
const CHUNK_OVERLAP = 2_000;

function buildSystemPrompt(): string {
  const docTypes = DOC_TYPES.join(", ");
  return (
    "You are an expert summarizer for real estate inspection reports. " +
    "Your only response should be a valid JSON object with the following top-level keys: " +
    "fileName, summary, addressNumber, streetName, suffix, city, county, zipcode, document_type, and inspection_date. " +
    `The value for \`document_type\` must be one of the following (classify the document accordingly): ${docTypes}. ` +
    "The value for `inspection_date` must be the date the inspection or disclosure was performed, extracted from the document content. Format YYYY-MM-DD. Use null if not found. " +
    "The value for `summary` must be a nested JSON object with the following keys: Roof, Electrical, Plumbing, Permits, Foundation, Pest Inspection, HVAC, and Additional Notes. " +
    "Each of the categories Roof, Electrical, Plumbing, Foundation, HVAC should contain: " +
    "- condition: A short description of current working condition. " +
    "- issues: A list of any notable concerns, maintenance, or repair items. " +
    "- age: A text string describing the known or estimated age (if available). " +
    "- end_of_life: A summary of whether the component is near or at the end of its life. " +
    "- recommendation: A short note on monitoring, repair, or replacement advice. Given the location, city/county, give a cost estimate for the replacement or repairs. " +
    "If cost estimates are explicitly provided in the document for any section, always use those exact values and do not generate or infer new estimates. Only generate cost estimates when none are provided in the source document." +
    "If end of life is mentioned, it is important to flag it." +
    "For Permits: condition (optional), notes, recommendations. " +
    "For Pest, structure the data with the following keys: " +
    "- condition: overall summary of the pest inspection. " +
    "- section_1: an object for Section 1 findings (active infestation or damage requiring immediate treatment), containing: findings (array of strings), recommendations (string), estimated_cost (string). " +
    "- section_2: an object for Section 2 findings (conditions likely to lead to infestation or damage, preventive work), containing: findings (array of strings), recommendations (string), estimated_cost (string). " +
    "- notes: any general notes not specific to Section 1 or Section 2. " +
    "If no Section 1 or Section 2 findings exist, omit those keys. " +
    "For Additional Notes, structure as a nested dictionary with keys like Kitchen, Bathroom, Windows, etc., and their respective findings. " +
    "If an entire section is missing, omit it. If a section is present but specific fields are missing, include only the available fields and do not add placeholder text." +
    "Ensure the values for addressNumber and streetName contain no spaces, and split the suffix from the street name. " +
    "Do not include any commentary, markdown, or explanations — respond with a JSON object only. " +
    "Ensure the json is properly formatted and valid. " +
    "Ensure that the JSON falls within the maximum token limit of 4000 tokens."
  );
}

function buildMapSystemPrompt(): string {
  const docTypes = DOC_TYPES.join(", ");
  return (
    "You are an expert extractor for real estate inspection reports. " +
    "You will receive an excerpt from a larger document — extract only what is visible in this portion. " +
    "Your only response should be a valid JSON object with the following top-level keys: " +
    "fileName, summary, addressNumber, streetName, suffix, city, county, zipcode, document_type, and inspection_date. " +
    `The value for \`document_type\` must be one of the following: ${docTypes}. ` +
    "The value for `inspection_date` must be the date the inspection was performed, formatted YYYY-MM-DD. Use null if not found in this excerpt. " +
    "For any field you cannot determine from this excerpt alone, use null. " +
    "The value for `summary` must be a nested JSON object with the following keys: Roof, Electrical, Plumbing, Permits, Foundation, Pest Inspection, HVAC, and Additional Notes. " +
    "Each of the categories Roof, Electrical, Plumbing, Foundation, HVAC should contain: " +
    "- condition: A short description of current working condition. " +
    "- issues: A list of any notable concerns, maintenance, or repair items visible in this excerpt. " +
    "- age: A text string describing the known or estimated age (if available). " +
    "- end_of_life: A summary of whether the component is near or at the end of its life. " +
    "- recommendation: A short note on monitoring, repair, or replacement advice. Only include cost estimates if explicitly stated in this excerpt. " +
    "For Permits: condition (optional), notes, recommendations. " +
    "For Pest, structure the data with the following keys: " +
    "- condition: overall summary of the pest inspection. " +
    "- section_1: an object for Section 1 findings, containing: findings (array of strings), recommendations (string), estimated_cost (string). " +
    "- section_2: an object for Section 2 findings, containing: findings (array of strings), recommendations (string), estimated_cost (string). " +
    "- notes: any general notes not specific to Section 1 or Section 2. " +
    "If no Section 1 or Section 2 findings exist in this excerpt, omit those keys. " +
    "For Additional Notes, structure as a nested dictionary with keys like Kitchen, Bathroom, Windows, etc., and their respective findings. " +
    "If an entire section is not mentioned in this excerpt, omit it. " +
    "Do not include any commentary, markdown, or explanations — respond with a JSON object only. " +
    "Ensure the JSON is properly formatted and valid."
  );
}

function buildReduceSystemPrompt(): string {
  return (
    "You are merging multiple partial analyses of the same inspection document into a single unified analysis. " +
    "You will receive a JSON array of partial results, each extracted from a different portion of the same document. " +
    "Merge them into one final JSON object with the following top-level keys: " +
    "fileName, summary, addressNumber, streetName, suffix, city, county, zipcode, document_type, and inspection_date. " +
    "Merge rules: " +
    "(1) For scalar fields (condition, age, end_of_life, recommendation, inspection_date, addressNumber, streetName, suffix, city, county, zipcode, document_type, fileName): use the first non-null value across all partials. " +
    "(2) For array fields (issues, findings): concatenate all values from all partials and remove exact duplicates. " +
    "(3) For the summary sections, merge all findings together — if a section appears in some partials but not others, include it with whatever information is available. " +
    "(4) Do not invent or infer information not present in any partial. " +
    "(5) If cost estimates appear in multiple partials for the same section, prefer the one that references an explicit document value. " +
    "Ensure the values for addressNumber and streetName contain no spaces, and split the suffix from the street name. " +
    "Do not include any commentary, markdown, or explanations — respond with a JSON object only. " +
    "Ensure the JSON is properly formatted and valid. " +
    "Ensure the JSON falls within the maximum token limit of 4000 tokens."
  );
}

async function extractTextFromFile(
  storagePath: string,
  objectStorageService: ObjectStorageService
): Promise<string> {
  const objectFile = await objectStorageService.getObjectEntityFile(storagePath);

  let buffer: Buffer;
  let s3Ref: S3FileRef | null = null;
  if (typeof objectFile === "string") {
    // Local storage: read from disk
    buffer = fs.readFileSync(objectFile);
  } else {
    s3Ref = objectFile;
    // S3: stream the object
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: objectFile.bucketName, Key: objectFile.objectKey })
    );
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = response.Body as Readable;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    buffer = Buffer.concat(chunks);
  }

  // Primary extraction via pdf-parse wrapper
  let text = "";
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: VerbosityLevel.ERRORS });
    const result = await parser.getText();
    await parser.destroy();
    text = result.text;
  } catch (err) {
    log(`pdf-parse failed: ${err}`, "analyze");
  }

  // If we got very little text (e.g. DocuSign-wrapped PDFs where real content
  // lives in form XObjects), re-extract directly via pdfjs-dist with
  // useSystemFonts which resolves embedded font references inside those XObjects.
  if (text.trim().length < 500) {
    log(`Primary extraction returned <500 chars, retrying with pdfjs-dist direct`, "analyze");
    try {
      const doc = await (pdfjs as any).getDocument({
        data: new Uint8Array(buffer),
        verbosity: 0,
        useSystemFonts: true,
        disableFontFace: true,
      }).promise;

      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = (content.items as any[])
          .filter((item) => "str" in item && (item as any).str.trim())
          .map((item) => (item as any).str)
          .join(" ");
        pages.push(pageText);
        page.cleanup();
      }
      await doc.destroy();
      const directText = pages.join("\n\n");

      if (directText.trim().length > text.trim().length) {
        log(`pdfjs-dist direct extraction got ${directText.length} chars (was ${text.length})`, "analyze");
        text = directText;
      }
    } catch (err) {
      log(`pdfjs-dist direct extraction failed: ${err}`, "analyze");
    }
  }

  if (text.trim().length >= 500) return text;

  // OCR fallback for scanned/image-based PDFs (e.g. DocuSign-wrapped scans).
  // Requires the file to be in S3 so Textract can access it directly.
  if (s3Ref) {
    log(`Text extraction empty, attempting OCR via AWS Textract`, "analyze");
    try {
      text = await extractTextWithTextract(s3Ref.bucketName, s3Ref.objectKey);
      log(`Textract OCR returned ${text.length} chars`, "analyze");
      if (text.trim()) return text;
    } catch (err) {
      log(`Textract OCR failed: ${err}`, "analyze");
    }
  }

  // Last resort: treat buffer as plain text (e.g. .txt uploads)
  log(`All extraction attempts failed, falling back to plain text`, "analyze");
  return buffer.toString("utf-8");
}

function buildCombineSystemPrompt(): string{
    return (
        "You are an expert at merging multiple real estate inspection report analyses into a single unified analysis. "+
        "You will receive a JSON array of individual document analyses. Each analysis has fields including: "+
        "addressNumber, streetName, suffix, city, county, zipcode, document_type, inspection_date, fileName, and summary. "+
        "Your task is to merge these into a single unified analysis JSON object. "+

        "The output must have the following top-level keys: "+
        "fileName, addressNumber, streetName, suffix, city, county, zipcode, document_type, inspection_date, summary, sources, conflict_notes. "+

        "Set `document_type` to \"Combined Analysis\". "+
        "Set `inspection_date` to the date of the most recently dated source document (the latest inspection_date value among sources). "+
        "Set `fileName` to 'Combined Analysis'. "+

        "For `sources`, provide an array of objects, one per source document, each with: document_type, inspection_date, fileName. "+

        "For `conflict_notes`, write a plain string describing any contradictions found between sources and which was preferred. "+

        "When two sources conflict on a section, resolve using the following priority: "+
        "1. Prefer specialized inspections over general home inspections for their respective sections. "+
        "2. If both sources are of the same type (both specialized or both general), prefer the one with the later inspection_date. "+
        "3. If dates are equal or null, note the conflict without failing. "+

        "Specialized inspections include, but are not limited to: "+
        "Pest Inspection (Pest-related findings), Roof Inspection (Roof), Structural/Engineering reports (Foundation), "+
        "HVAC Inspection (HVAC), Electrical Inspection (Electrical), Plumbing Inspection (Plumbing). "+

        "If a specialized inspection exists for a section, treat it as the authoritative source for that section, even if its inspection_date is earlier than a general home inspection. "+
        "Use general home inspections only as supplementary context. "+

        "When both a specialized inspection and a general inspection provide information for the same section: "+
        "Use the specialized inspection for condition, issues, and recommendations. "+
        "Only include additional relevant details from the general inspection if they do not contradict the specialized report. "+

        "If multiple specialized inspections exist for the same section, prefer the one with the most recent inspection_date. "+

        "If conflicts arise between a specialized and general inspection, always prefer the specialized inspection and document this decision in `conflict_notes`. "+

        "For the `summary` object, merge all sections (Roof, Electrical, Plumbing, Permits, Foundation, Pest Inspection, HVAC, Additional Notes) by combining findings from all sources. "+
        "If a section appears in some documents but not others, still include it with whatever information is available. "+

        "Do not include any commentary, markdown, or explanations — respond with a JSON object only. "+
        "Ensure the JSON is properly formatted and valid. "+
        "Ensure the JSON falls within the maximum token limit of 4000 tokens."
    );
  }

export function registerFolderCombinedAnalysisRoute(app: Express): void {
  app.post("/api/folders/:id/combined-analysis/", async (req, res) => {
    try {
      const folderId = req.params.id;
      const cookies = req.headers.cookie || "";
      const requestId = (req as any).requestId ?? "-";
      const { document_ids } = req.body as { document_ids: number[] };

      if (!document_ids || !Array.isArray(document_ids) || document_ids.length < 2) {
        return res.status(400).json({ error: "At least 2 document IDs are required" });
      }

      // Fetch all documents the user can see, then filter to selected IDs
      const docsRes = await fetch(`http://127.0.0.1:8000/api/documents/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });

      if (!docsRes.ok) {
        return res.status(docsRes.status).json({ error: "Failed to fetch documents" });
      }

      const allDocs = (await docsRes.json()) as any[];
      const selectedDocs = allDocs.filter((d: any) => document_ids.includes(d.id));

      if (selectedDocs.length < 2) {
        return res.status(400).json({ error: "Could not find the selected documents" });
      }

      // Validate all docs have a valid ai_analysis (not raw fallback)
      const unanalyzed = selectedDocs.filter(
        (d: any) => !d.ai_analysis || d.ai_analysis.raw_response !== undefined || !d.ai_analysis.summary
      );
      if (unanalyzed.length > 0) {
        return res.status(400).json({
          error: `Some documents have not been analyzed yet: ${unanalyzed.map((d: any) => d.name).join(", ")}`,
        });
      }

      log(`Combining ${selectedDocs.length} documents for folder ${folderId}`, "analyze");

      const perplexity = makePerplexityClient();

      const analysesPayload = selectedDocs.map((d: any) => ({
        ...d.ai_analysis,
        fileName: d.name,
      }));

      const completion = await perplexity.chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: buildCombineSystemPrompt() },
          {
            role: "user",
            content: `Merge these document analyses:\n\n${JSON.stringify(analysesPayload, null, 2)}`,
          },
        ],
        max_tokens: 4000,
      });

      const rawContent = completion.choices[0]?.message?.content || "";

      let combinedAnalysis: any;
      try {
        // Strip markdown fences, then extract outermost {...} to handle
        // Perplexity citations or trailing text appended after the JSON object.
        const stripped = rawContent.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
        const start = stripped.indexOf("{");
        const end = stripped.lastIndexOf("}");
        if (start === -1 || end === -1 || end < start) throw new Error("No JSON object found");
        combinedAnalysis = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        log(`Failed to parse combined AI response as JSON`, "analyze");
        return res.status(500).json({ error: "AI returned an invalid response. Please try again." });
      }

      // Save to Django — deducts 1 credit and persists the record
      const saveRes = await fetch(`http://127.0.0.1:8000/api/combined-analyses/save/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({
          folder_id: parseInt(folderId, 10),
          document_ids,
          combined_analysis: combinedAnalysis,
        }),
      });

      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        log(`Failed to save combined analysis: ${saveRes.status}`, "analyze");
        return res.status(saveRes.status).json(errData);
      }

      const record = await saveRes.json();
      log(`Combined analysis saved for folder ${folderId}`, "analyze");
      return res.status(201).json(record);
    } catch (err: any) {
      log(`Combined analysis error: ${err.message}`, "analyze");
      return res.status(500).json({ error: "Combined analysis failed: " + err.message });
    }
  });
}

const EMAIL_SYSTEM_PROMPT =
  "You are a licensed real estate professional drafting a neutral, factual email summarizing a home inspection report for buyers.\n\n" +
  "Write a clear and organized summary that:\n\n" +
  "- Presents facts without interpretation or persuasion\n" +
  "- Does not recommend whether the buyer should proceed\n" +
  "- Does not use emotionally charged language\n" +
  "- Does not minimize or exaggerate findings\n" +
  "- Does not suggest negotiation strategy\n" +
  "- Avoids alarmist tone\n\n" +
  "Structure the email as follows:\n\n" +
  "1. Property reference (address and report type)\n" +
  "2. Brief overview explaining that this is a summary of documented findings\n" +
  "3. Major systems summary (Roof, Electrical, Plumbing, Foundation, HVAC)\n" +
  "   - Current condition (as stated)\n" +
  "   - Noted issues\n" +
  "   - Inspector recommendations\n" +
  "   - Estimated cost ranges (if provided)\n" +
  "4. Additional findings grouped by area (Interior, Exterior, Garage, Crawlspace, etc.)\n" +
  "5. Items noted as near or beyond typical useful life\n" +
  "6. Closing statement encouraging buyer to review full report and consult appropriate licensed professionals for further evaluation\n\n" +
  "Do not:\n" +
  "- Provide opinions\n" +
  '- Use phrases like "good news" or "major concern"\n' +
  "- Provide total repair estimates unless directly calculable from provided ranges\n" +
  "- Suggest next steps beyond reviewing and consulting professionals\n\n" +
  "Respond with only the email text — no preamble, no markdown headers, no JSON.";

export function registerDraftEmailRoute(app: Express): void {
  let _perplexity: OpenAI | null = null;
  const perplexity = () => {
    if (!_perplexity) _perplexity = makePerplexityClient();
    return _perplexity;
  };

  app.post("/api/documents/:id/draft-email/", async (req, res) => {
    try {
      const docId = req.params.id;
      const cookies = req.headers.cookie || "";
      const requestId = (req as any).requestId ?? "-";

      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });

      if (!docRes.ok) {
        return res.status(docRes.status).json({ error: "Document not found" });
      }

      const doc = (await docRes.json()) as any;

      if (!doc.ai_analysis || doc.ai_analysis.raw_response) {
        return res.status(400).json({ error: "Document must be analyzed before drafting an email." });
      }

      log(`Drafting email for document ${docId}: ${doc.name}`, "analyze");

      const completion = await perplexity().chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: EMAIL_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Here are the inspection details:\n\n${JSON.stringify(doc.ai_analysis, null, 2)}`,
          },
        ],
        max_tokens: 2000,
      });

      const emailDraft = completion.choices[0]?.message?.content?.trim() || "";

      const saveRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ email_draft: emailDraft }),
      });

      if (!saveRes.ok) {
        log(`Failed to save email draft to Django: ${saveRes.status}`, "analyze");
        return res.status(500).json({ error: "Failed to save email draft" });
      }

      const updatedDoc = await saveRes.json();
      log(`Email draft saved for document ${docId}`, "analyze");
      return res.json({ email_draft: updatedDoc.email_draft });
    } catch (err: any) {
      log(`Draft email error: ${err.message}`, "analyze");
      return res.status(500).json({ error: "Email draft failed: " + err.message });
    }
  });
}

const FILE_SCREENING_SYSTEM_PROMPT =
  "You are screening file names before uploading to a real estate document analysis platform. " +
  "Your job is to APPROVE only files that are property inspection or condition reports: " +
  "home inspection reports, pest/termite inspection reports, roof inspection reports, " +
  "HVAC inspection reports, plumbing inspection reports, electrical inspection reports, " +
  "foundation inspection reports, sewer inspection reports, pool inspection reports, " +
  "permit reports, natural hazard disclosures (NHD), and property condition disclosures. " +
  "REJECT everything else, including: avids, addendums, purchase agreements, contracts, certificates, " +
  "transaction coordination documents, marketing materials, personal financial documents, " +
  "spreadsheets, flyers, correspondence, HOA documents, title documents, escrow instructions, " +
  "and any file whose name does not clearly indicate it is a property inspection or condition report. " +
  "When in doubt, REJECT the file. " +
  "Return ONLY a valid JSON object with a single key 'approved' containing an array of the approved file names exactly as provided. " +
  "Do not include any commentary, markdown, or explanations — respond with the JSON object only.";

export function registerFileScreeningRoute(app: Express): void {
  let _perplexity: OpenAI | null = null;
  const perplexity = () => {
    if (!_perplexity) _perplexity = makePerplexityClient();
    return _perplexity;
  };

  app.post("/api/screen-files/", async (req, res) => {
    try {
      const { file_names } = req.body as { file_names: string[] };
      const requestId = (req as any).requestId ?? "-";

      if (!Array.isArray(file_names) || file_names.length === 0) {
        return res.status(400).json({ error: "file_names must be a non-empty array" });
      }

      log(`[screen-files] req=${requestId} screening ${file_names.length} files`, "analyze");

      const completion = await perplexity().chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: FILE_SCREENING_SYSTEM_PROMPT },
          { role: "user", content: `File names to evaluate:\n${JSON.stringify(file_names)}` },
        ],
        max_tokens: 500,
      });

      const rawContent = completion.choices[0]?.message?.content || "";

      let result: { approved: string[] };
      try {
        const cleaned = rawContent.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
        result = JSON.parse(cleaned);
        if (!Array.isArray(result.approved)) throw new Error("missing approved array");
      } catch {
        log(`[screen-files] failed to parse AI response: ${rawContent}`, "analyze");
        return res.status(500).json({ error: "AI returned an invalid response. Please try again." });
      }

      log(`[screen-files] approved ${result.approved.length}/${file_names.length} files`, "analyze");
      return res.json(result);
    } catch (err: any) {
      log(`[screen-files] error: ${err.message}`, "analyze");
      return res.status(500).json({ error: "File screening failed: " + err.message });
    }
  });
}

export function registerDocumentDeleteRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  app.delete("/api/documents/:id/", async (req, res) => {
    const docId = req.params.id;
    const cookies = req.headers.cookie || "";
    const requestId = (req as any).requestId ?? "-";

    log(`[DELETE] doc=${docId}`, "analyze");

    try {
      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });

      if (!docRes.ok) {
        return res.status(docRes.status).json({ error: "Document not found" });
      }

      const doc = (await docRes.json()) as any;

      if (doc.storage_path) {
        const storagePath = objectStorageService.normalizeObjectEntityPath(doc.storage_path);
        log(`[DELETE] deleting storage: ${storagePath}`, "analyze");
        await objectStorageService.deleteObjectEntity(storagePath);
        log(`[DELETE] storage deleted for doc ${docId}`, "analyze");
      }

      const deleteRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        method: "DELETE",
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });

      log(`[DELETE] Django delete status=${deleteRes.status}`, "analyze");
      return res.status(deleteRes.status).send();
    } catch (err: any) {
      log(`[DELETE] error: ${err.message}`, "analyze");
      return res.status(500).json({ error: err.message });
    }
  });
}

function splitIntoChunks(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

function parseJsonResponse(raw: string): any {
  const cleaned = raw.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function analyzeSingleCall(text: string, perplexity: OpenAI): Promise<any> {
  const completion = await perplexity.chat.completions.create({
    model: "sonar-pro",
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: `Analyze the following document:\n\n${text}` },
    ],
    max_tokens: 4000,
  });
  const raw = completion.choices[0]?.message?.content || "";
  try {
    return parseJsonResponse(raw);
  } catch {
    log(`Failed to parse AI response as JSON, storing as raw`, "analyze");
    return { raw_response: raw };
  }
}

async function analyzeWithChunking(text: string, perplexity: OpenAI, precomputedChunks?: string[]): Promise<any> {
  const chunks = precomputedChunks ?? splitIntoChunks(text);
  log(`Map phase: processing ${chunks.length} chunks`, "analyze");

  const partials: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const completion = await perplexity.chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: buildMapSystemPrompt() },
          { role: "user", content: `This is part ${i + 1} of ${chunks.length} of the document. Analyze:\n\n${chunks[i]}` },
        ],
        max_tokens: 2000,
      });
      const raw = completion.choices[0]?.message?.content || "";
      partials.push(parseJsonResponse(raw));
      log(`Chunk ${i + 1}/${chunks.length} complete`, "analyze");
    } catch (err) {
      log(`Chunk ${i + 1}/${chunks.length} failed: ${err}, skipping`, "analyze");
    }
  }

  if (partials.length === 0) {
    log(`All chunks failed, falling back to single-call on first ${SINGLE_CALL_LIMIT} chars`, "analyze");
    return analyzeSingleCall(text.slice(0, SINGLE_CALL_LIMIT), perplexity);
  }

  log(`Reduce phase: merging ${partials.length} partial analyses`, "analyze");
  try {
    const completion = await perplexity.chat.completions.create({
      model: "sonar-pro",
      messages: [
        { role: "system", content: buildReduceSystemPrompt() },
        { role: "user", content: `Merge these partial analyses into one:\n\n${JSON.stringify(partials)}` },
      ],
      max_tokens: 4000,
    });
    const raw = completion.choices[0]?.message?.content || "";
    return parseJsonResponse(raw);
  } catch (err) {
    log(`Reduce phase failed: ${err}, returning first successful partial`, "analyze");
    return partials[0];
  }
}

export function registerAnalyzeRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();
  let perplexity: OpenAI | null = null;
  const getPerplexity = () => {
    if (!perplexity) perplexity = makePerplexityClient();
    return perplexity;
  };

  app.get("/api/documents/:id/analyze-cost/", async (req, res) => {
    try {
      const docId = req.params.id;
      const cookies = req.headers.cookie || "";
      const requestId = (req as any).requestId ?? "-";

      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });
      if (!docRes.ok) return res.status(docRes.status).json({ error: "Document not found" });

      const doc = (await docRes.json()) as any;
      if (!doc.storage_path) return res.json({ credits_required: 1 });

      const storagePath = objectStorageService.normalizeObjectEntityPath(doc.storage_path);
      const documentText = await extractTextFromFile(storagePath, objectStorageService);
      const chunks = splitIntoChunks(documentText);
      return res.json({ credits_required: chunks.length, char_count: documentText.length });
    } catch (err: any) {
      // On error, fall back to 1 credit so the user isn't blocked
      return res.json({ credits_required: 1 });
    }
  });

  app.post("/api/documents/:id/analyze/", async (req, res) => {
    try {
      const docId = req.params.id;
      const cookies = req.headers.cookie || "";
      const requestId = (req as any).requestId ?? "-";

      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });

      if (!docRes.ok) {
        return res.status(docRes.status).json({ error: "Document not found" });
      }

      const doc = (await docRes.json()) as any;
      const rawStoragePath = doc.storage_path;

      if (!rawStoragePath) {
        return res.status(400).json({ error: "This document has no uploaded file to analyze. Please re-upload the file first." });
      }

      log(`Analyzing document ${docId}: ${doc.name}`, "analyze");
      log(`Raw storage_path from Django: ${rawStoragePath}`, "analyze");

      // Normalize S3 presigned URLs or bare paths to the internal /objects/... format
      const storagePath = objectStorageService.normalizeObjectEntityPath(rawStoragePath);
      log(`Resolved storage path: ${storagePath}`, "analyze");

      let documentText: string;
      try {
        documentText = await extractTextFromFile(storagePath, objectStorageService);
      } catch (err: any) {
        log(`Failed to read file: ${err.message}`, "analyze");
        return res.status(400).json({ error: "Could not read the document file from storage. The file may need to be re-uploaded." });
      }

      if (!documentText.trim()) {
        return res.status(400).json({ error: "Could not extract text from document" });
      }

      const charCount = documentText.length;
      const estimatedTokens = Math.round(charCount / 4);
      const chunks = splitIntoChunks(documentText);
      log(`Extracted text: ${charCount} chars, ~${estimatedTokens} tokens, ${chunks.length} chunk${chunks.length > 1 ? 's' : ''} needed`, "analyze");

      let analysisJson: any;
      let creditsUsed = 1;
      if (documentText.length <= SINGLE_CALL_LIMIT) {
        analysisJson = await analyzeSingleCall(documentText, getPerplexity());
      } else {
        creditsUsed = chunks.length;
        log(`Using map-reduce: ${creditsUsed} chunks, costs ${creditsUsed} credits`, "analyze");
        analysisJson = await analyzeWithChunking(documentText, getPerplexity(), chunks);
      }

      const saveRes = await fetch(
        `http://127.0.0.1:8000/api/documents/${docId}/analyze/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookies,
            "X-Request-Id": requestId,
          },
          body: JSON.stringify({
            ai_analysis: analysisJson,
            ai_score: analysisJson.ai_score || null,
            credits_used: creditsUsed,
          }),
        }
      );

      if (!saveRes.ok) {
        log(`Failed to save analysis to Django: ${saveRes.status}`, "analyze");
        return res.status(500).json({ error: "Failed to save analysis" });
      }

      const updatedDoc = await saveRes.json();
      log(`Analysis complete for document ${docId}`, "analyze");
      return res.json(updatedDoc);
    } catch (err: any) {
      log(`Analysis error: ${err.message}`, "analyze");
      return res.status(500).json({ error: "Analysis failed: " + err.message });
    }
  });
}

export function registerTranslateRoute(app: Express): void {
  app.post("/api/translate/", async (req, res) => {
    const requestId = (req as any).requestId ?? "-";
    const cookies = req.headers.cookie || "";
    try {
      const { q, target, targetLabel } = req.body as { q: string[]; target: string; targetLabel?: string };

      log(`[translate] req=${requestId} target=${target} strings=${q?.length}`, "translate");

      if (!Array.isArray(q) || q.length === 0 || !target) {
        log(`[translate] req=${requestId} bad request: q=${JSON.stringify(q)} target=${target}`, "translate");
        return res.status(400).json({ error: "q (non-empty array) and target language are required" });
      }

      // Deduct 1 credit before translating
      const deductRes = await fetch("http://127.0.0.1:8000/api/credits/deduct-translate/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ target_language: targetLabel ?? target }),
      });

      if (!deductRes.ok) {
        const body = await deductRes.json().catch(() => ({})) as any;
        const msg = body?.error ?? "Insufficient credits";
        log(`[translate] req=${requestId} credit deduction failed (${deductRes.status}): ${msg}`, "translate");
        return res.status(deductRes.status).json({ error: msg });
      }

      const region = process.env.AWS_REGION || "us-east-1";
      const hasKey = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
      log(`[translate] req=${requestId} region=${region} credentials=${hasKey ? "present" : "MISSING"}`, "translate");

      const { TranslateClient, TranslateTextCommand } = await import("@aws-sdk/client-translate");
      const client = new TranslateClient({ region });

      const translations = await Promise.all(
        q.map(async (text, i) => {
          try {
            const command = new TranslateTextCommand({
              Text: text,
              SourceLanguageCode: "auto",
              TargetLanguageCode: target,
            });
            const result = await client.send(command);
            return result.TranslatedText ?? text;
          } catch (itemErr: any) {
            log(`[translate] req=${requestId} item[${i}] error: ${itemErr.message}`, "translate");
            throw itemErr;
          }
        })
      );

      log(`[translate] req=${requestId} success: translated ${translations.length} strings`, "translate");
      return res.json({ translations });
    } catch (err: any) {
      log(`[translate] req=${requestId} error: ${err.name}: ${err.message}`, "translate");
      return res.status(500).json({ error: "Translation failed: " + err.message });
    }
  });
}

function buildLocalLeadsPrompt(categories: string[]): string {
  return (
    "You are a local contractor research assistant. Given a property location and a list of trade categories " +
    "where repairs or issues were found, find the top 3 active businesses for each listed category. " +
    "For each business, search Google Maps, Yelp, or the contractor's website to find their star rating and review count. " +
    "You MUST include the numeric rating (e.g. 4.7) and review count (e.g. 83) whenever they appear on Google or Yelp — do not leave these null if the data is publicly available. " +
    "Rank by: proximity, Google/Yelp rating, review count, review recency, and service relevance. " +
    "Only include businesses that are currently operating and serve the given location. " +
    "Respond with ONLY a valid JSON object — no markdown, no commentary. " +
    `The object must have exactly these keys: ${categories.join(", ")}. ` +
    "Each key maps to an array of up to 3 objects with these fields: " +
    "name (string), rating (number or null), review_count (number or null), address (string or null), " +
    "phone (string or null), website (string or null), reason (string), lead_signals (array of strings). " +
    "lead_signals examples: 'online booking', 'emergency service', 'same-day service', 'licensed'. " +
    "If fewer than 3 strong results exist for a category, return only the ones that genuinely qualify. " +
    "Do NOT include a business if it is not a direct match for the trade category (e.g. do not list a general contractor under PestControl). " +
    "If no qualifying businesses are found for a category, return an empty array [] for that key — never fabricate or stretch a result to fill the slot."
  );
}

/** Returns the trade category keys that have actionable issues in the analysis summary. */
function categoriesNeedingContractors(summary: any): string[] {
  const needed: string[] = [];

  const hasIssues = (section: any): boolean => {
    if (!section) return false;
    if (Array.isArray(section.issues) && section.issues.length > 0) return true;
    // Only actionable repair language — exclude "monitor", "age", "concern" which appear in routine descriptions
    if (section.recommendation && /repair|replac|damage|fail|leak|crack|deteriorat|worn|end.of.life/i.test(section.recommendation)) return true;
    // "poor" condition is clearly problematic; "fair" is routine and should not trigger contractor search
    if (section.condition && /poor|damage|deteriorat|fail|crack|leak/i.test(section.condition)) return true;
    // Match "near end of life", "approaching end", "replacement" but not bare "end"
    if (section.end_of_life && /near|approach|replac/i.test(section.end_of_life)) return true;
    return false;
  };

  if (hasIssues(summary?.Plumbing)) needed.push("Plumbing");
  if (hasIssues(summary?.Electrical)) needed.push("Electrical");
  if (hasIssues(summary?.Roof)) needed.push("RoofRepair");

  // Pest: has findings if section_1 or section_2 exist with content
  const pest = summary?.["Pest Inspection"];
  if (pest) {
    const hasSection1 = Array.isArray(pest.section_1?.findings) && pest.section_1.findings.length > 0;
    const hasSection2 = Array.isArray(pest.section_2?.findings) && pest.section_2.findings.length > 0;
    if (hasSection1 || hasSection2 || hasIssues(pest)) needed.push("PestControl");
  }

  return needed;
}

export function registerLocalLeadsRoute(app: Express): void {
  let _perplexity: OpenAI | null = null;
  const perplexity = () => {
    if (!_perplexity) _perplexity = makePerplexityClient();
    return _perplexity;
  };

  app.post("/api/documents/:id/local-leads/", async (req, res) => {
    const requestId = (req as any).requestId ?? "-";
    const cookies = req.headers.cookie || "";
    try {
      const docId = req.params.id;

      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });
      if (!docRes.ok) return res.status(docRes.status).json({ error: "Document not found" });

      const doc = (await docRes.json()) as any;
      if (!doc.ai_analysis || doc.ai_analysis.raw_response) {
        return res.status(400).json({ error: "Document must be analyzed before finding local contractors." });
      }

      const { city, county, zipcode } = doc.ai_analysis;
      const location = [city, county, zipcode].filter(Boolean).join(", ");
      if (!location) {
        return res.status(400).json({ error: "No location found in analysis. Cannot search for local contractors." });
      }

      const categories = categoriesNeedingContractors(doc.ai_analysis.summary ?? {});
      if (categories.length === 0) {
        log(`[local-leads] req=${requestId} no repairs/issues found — skipping`, "leads");
        return res.json({ local_leads: {}, no_repairs: true });
      }

      // Deduct 1 credit before searching
      const deductRes = await fetch("http://127.0.0.1:8000/api/credits/deduct-local-leads/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies, "X-Request-Id": requestId },
        body: JSON.stringify({ location }),
      });
      if (!deductRes.ok) {
        const body = await deductRes.json().catch(() => ({})) as any;
        const msg = body?.error ?? "Insufficient credits";
        log(`[local-leads] req=${requestId} credit deduction failed (${deductRes.status}): ${msg}`, "leads");
        return res.status(deductRes.status).json({ error: msg });
      }

      log(`[local-leads] req=${requestId} location="${location}" categories=${categories.join(",")}`, "leads");

      const completion = await perplexity().chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: buildLocalLeadsPrompt(categories) },
          { role: "user", content: `Find local contractors for ${categories.join(", ")} near: ${location}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log(`[local-leads] req=${requestId} no JSON in response`, "leads");
        return res.status(500).json({ error: "Could not parse contractor results." });
      }

      const leads = JSON.parse(jsonMatch[0]);
      log(`[local-leads] req=${requestId} success`, "leads");

      // Persist leads into ai_analysis so they survive page refresh
      const updatedAnalysis = { ...doc.ai_analysis, local_leads: leads };
      await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookies, "X-Request-Id": requestId },
        body: JSON.stringify({ ai_analysis: updatedAnalysis }),
      });

      return res.json({ local_leads: leads });
    } catch (err: any) {
      log(`[local-leads] req=${requestId} error: ${err.message}`, "leads");
      return res.status(500).json({ error: "Local leads search failed: " + err.message });
    }
  });

  app.post("/api/combined-analyses/:id/local-leads/", async (req, res) => {
    const requestId = (req as any).requestId ?? "-";
    const cookies = req.headers.cookie || "";
    try {
      const caId = req.params.id;

      const caRes = await fetch(`http://127.0.0.1:8000/api/combined-analyses/${caId}/`, {
        headers: { Cookie: cookies, "X-Request-Id": requestId },
      });
      if (!caRes.ok) return res.status(caRes.status).json({ error: "Combined analysis not found" });

      const record = (await caRes.json()) as any;
      const ca = record.combined_analysis;
      if (!ca || !ca.summary) {
        return res.status(400).json({ error: "Combined analysis has no summary to evaluate." });
      }

      const { city, county, zipcode } = ca;
      const location = [city, county, zipcode].filter(Boolean).join(", ");
      if (!location) {
        return res.status(400).json({ error: "No location found in combined analysis. Cannot search for local contractors." });
      }

      const categories = categoriesNeedingContractors(ca.summary ?? {});
      if (categories.length === 0) {
        log(`[local-leads/ca] req=${requestId} no repairs/issues found — skipping`, "leads");
        return res.json({ local_leads: {}, no_repairs: true });
      }

      // Deduct 1 credit before searching
      const deductRes = await fetch("http://127.0.0.1:8000/api/credits/deduct-local-leads/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies, "X-Request-Id": requestId },
        body: JSON.stringify({ location }),
      });
      if (!deductRes.ok) {
        const body = await deductRes.json().catch(() => ({})) as any;
        const msg = body?.error ?? "Insufficient credits";
        log(`[local-leads/ca] req=${requestId} credit deduction failed (${deductRes.status}): ${msg}`, "leads");
        return res.status(deductRes.status).json({ error: msg });
      }

      log(`[local-leads/ca] req=${requestId} location="${location}" categories=${categories.join(",")}`, "leads");

      const completion = await perplexity().chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: buildLocalLeadsPrompt(categories) },
          { role: "user", content: `Find local contractors for ${categories.join(", ")} near: ${location}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log(`[local-leads/ca] req=${requestId} no JSON in response`, "leads");
        return res.status(500).json({ error: "Could not parse contractor results." });
      }

      const leads = JSON.parse(jsonMatch[0]);
      log(`[local-leads/ca] req=${requestId} success`, "leads");

      // Persist leads into combined_analysis so they survive page refresh
      const updatedAnalysis = { ...ca, local_leads: leads };
      await fetch(`http://127.0.0.1:8000/api/combined-analyses/${caId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookies, "X-Request-Id": requestId },
        body: JSON.stringify({ combined_analysis: updatedAnalysis }),
      });

      return res.json({ local_leads: leads });
    } catch (err: any) {
      log(`[local-leads/ca] req=${requestId} error: ${err.message}`, "leads");
      return res.status(500).json({ error: "Local leads search failed: " + err.message });
    }
  });
}
