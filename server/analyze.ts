import type { Express } from "express";
import OpenAI from "openai";
import { PDFParse, VerbosityLevel } from "pdf-parse";
import { Readable } from "stream";
import * as fs from "fs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ObjectStorageService } from "./replit_integrations/object_storage/objectStorage";
import { s3Client, S3FileRef } from "./replit_integrations/object_storage/s3Client";
import { log } from "./index";

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
    "fileName, summary, addressNumber, streetName, suffix, city, county, zipcode, and document_type. " +
    `The value for \`document_type\` must be one of the following (classify the document accordingly): ${docTypes}. ` +
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

export function registerAnalyzeRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  const perplexity = new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: "https://api.perplexity.ai",
  });

  app.post("/api/documents/:id/analyze/", async (req, res) => {
    try {
      const docId = req.params.id;
      const cookies = req.headers.cookie || "";

      const docRes = await fetch(`http://127.0.0.1:8000/api/documents/${docId}/`, {
        headers: { Cookie: cookies },
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
