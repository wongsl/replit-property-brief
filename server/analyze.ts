import type { Express } from "express";
import OpenAI from "openai";
import { PDFParse, VerbosityLevel } from "pdf-parse";
import { Readable } from "stream";
import * as fs from "fs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ObjectStorageService } from "./replit_integrations/object_storage/objectStorage";
import { s3Client, S3FileRef } from "./replit_integrations/object_storage/s3Client";
import { log } from "./index";

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
    "For Permits and Pest Inspection: " +
    "- condition (optional), " +
    "- notes, " +
    "- recommendations. " +
    "For Additional Notes, structure as a nested dictionary with keys like Kitchen, Bathroom, Windows, etc., and their respective findings. " +
    "If any information is missing or not mentioned in the input text, add a note that it was not in the disclosures provided. " +
    "Ensure the values for addressNumber and streetName contain no spaces, and split the suffix from the street name. " +
    "Do not include any commentary, markdown, or explanations — respond with a JSON object only. " +
    "Ensure the json is properly formatted and valid. " +
    "Ensure that the JSON falls within the maximum token limit of 4000 tokens."
  );
}

async function extractTextFromFile(
  storagePath: string,
  objectStorageService: ObjectStorageService
): Promise<string> {
  const objectFile = await objectStorageService.getObjectEntityFile(storagePath);

  let buffer: Buffer;
  if (typeof objectFile === "string") {
    // Local storage: read from disk
    buffer = fs.readFileSync(objectFile);
  } else {
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

  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: VerbosityLevel.ERRORS });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  } catch (err) {
    log(`PDF parsing failed, trying as plain text: ${err}`, "analyze");
    return buffer.toString("utf-8");
  }
}

function buildCombineSystemPrompt(): string {
  return (
    "You are an expert at merging multiple real estate inspection report analyses into a single unified analysis. " +
    "You will receive a JSON array of individual document analyses. Each analysis has fields including: " +
    "addressNumber, streetName, suffix, city, county, zipcode, document_type, inspection_date, fileName, and summary. " +
    "Your task is to merge these into a single unified analysis JSON object. " +
    "The output must have the following top-level keys: " +
    "fileName, addressNumber, streetName, suffix, city, county, zipcode, document_type, inspection_date, summary, sources, conflict_notes. " +
    'Set `document_type` to "Combined Analysis". ' +
    "Set `inspection_date` to the date of the most recently dated source document (the latest inspection_date value among sources). " +
    "Set `fileName` to 'Combined Analysis'. " +
    "For `sources`, provide an array of objects, one per source document, each with: document_type, inspection_date, fileName. " +
    "For `conflict_notes`, write a plain string describing any contradictions found between sources and which was preferred. " +
    "When two sources conflict on a section, prefer the one with the later inspection_date. If dates are equal or null, note the conflict without failing. " +
    "For the `summary` object, merge all sections (Roof, Electrical, Plumbing, Permits, Foundation, Pest Inspection, HVAC, Additional Notes) by combining findings from all sources. " +
    "If a section appears in some documents but not others, still include it with whatever information is available. " +
    "Do not include any commentary, markdown, or explanations — respond with a JSON object only. " +
    "Ensure the JSON is properly formatted and valid. " +
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
        const cleaned = rawContent.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
        combinedAnalysis = JSON.parse(cleaned);
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

export function registerAnalyzeRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();
  const perplexity = makePerplexityClient();

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

      const truncated = documentText.slice(0, 60000);

      log(`Extracted text preview (first 500 chars): ${documentText.slice(0, 500)}`, "analyze");
      log(`Sending ${truncated.length} chars to Perplexity for analysis`, "analyze");

      const completion = await perplexity.chat.completions.create({
        model: "sonar-pro",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `Analyze the following document:\n\n${truncated}`,
          },
        ],
        max_tokens: 4000,
      });

      const rawContent = completion.choices[0]?.message?.content || "";

      let analysisJson: any;
      try {
        const cleaned = rawContent.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
        analysisJson = JSON.parse(cleaned);
      } catch {
        log(`Failed to parse AI response as JSON, storing as raw`, "analyze");
        analysisJson = { raw_response: rawContent };
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
