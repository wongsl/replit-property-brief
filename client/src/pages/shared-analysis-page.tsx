import React, { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, Languages, FileDown, RefreshCw } from "lucide-react";

const TRANSLATE_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "vi", label: "Vietnamese" },
  { code: "tl", label: "Filipino" },
  { code: "it", label: "Italian" },
];

function extractStringPaths(obj: any, path: (string | number)[] = []): { path: (string | number)[]; value: string }[] {
  if (typeof obj === "string" && obj.trim()) return [{ path, value: obj }];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => extractStringPaths(v, [...path, i]));
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => extractStringPaths(v, [...path, k]));
  return [];
}

function applyStringPaths(obj: any, entries: { path: (string | number)[]; value: string }[]): any {
  const clone = JSON.parse(JSON.stringify(obj));
  for (const { path, value } of entries) {
    let curr = clone;
    for (let i = 0; i < path.length - 1; i++) curr = curr[path[i]];
    curr[path[path.length - 1]] = value;
  }
  return clone;
}

async function translateSummary(summary: any, targetLang: string, targetLabel: string): Promise<any> {
  const entries = extractStringPaths(summary);
  if (entries.length === 0) return summary;
  const res = await fetch("/api/translate/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: entries.map(e => e.value), target: targetLang, targetLabel }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Translation failed");
  }
  const { translations } = await res.json();
  const translated = entries.map((e, i) => ({ path: e.path, value: translations[i] ?? e.value }));
  return applyStringPaths(summary, translated);
}

function isNearEndOfLife(endOfLifeText: string | undefined): boolean {
  if (!endOfLifeText) return false;
  const t = endOfLifeText.toLowerCase();
  if (/not\s+near\s+end\s+of\s+life/.test(t)) return false;
  if (/not\s+(at|past|reached|approaching)\s+end\s+of\s+life/.test(t)) return false;
  if (/near\s+end\s+of\s+life/.test(t)) return true;
  if (/approaching\s+end(\s+of\s+life)?/.test(t)) return true;
  if (/past\s+(its\s+)?end\s+of\s+life/.test(t)) return true;
  if (/reached\s+end(\s+of(\s+(useful\s+)?life)?)?/.test(t)) return true;
  if (/end\s+of\s+(useful\s+)?life/.test(t)) return true;
  if (/^yes\b/.test(t)) return true;
  const match = t.match(/(\d+)\s*(?:–|-|to)?\s*\d*\s*year/);
  if (match) return parseInt(match[1], 10) <= 5;
  return false;
}

function CopyButton({ getText, className = "" }: { getText: () => string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost" size="icon"
      className={`h-6 w-6 ${className}`}
      onClick={() => { navigator.clipboard.writeText(getText()); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function formatSectionAsText(title: string, data: any): string {
  const lines: string[] = [title];
  if (title === "Additional Notes" && typeof data === 'object') {
    for (const [area, findings] of Object.entries(data)) {
      lines.push(`${area}:`);
      if (typeof findings === 'string') lines.push(`  ${findings}`);
      else if (typeof findings === 'object' && findings !== null) {
        for (const [k, v] of Object.entries(findings as any))
          lines.push(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
    return lines.join('\n');
  }
  if (data.condition) lines.push(`Condition: ${data.condition}`);
  if (data.age) lines.push(`Age: ${data.age}`);
  if (data.end_of_life) lines.push(`End of Life: ${data.end_of_life}`);
  if (data.issues?.length) { lines.push('Issues:'); data.issues.forEach((i: string) => lines.push(`  • ${i}`)); }
  if (data.recommendation) lines.push(`Recommendation: ${data.recommendation}`);
  if (data.recommendations) lines.push(`Recommendations: ${data.recommendations}`);
  if (data.notes) lines.push(`Notes: ${data.notes}`);
  return lines.join('\n');
}

function formatAnalysisAsText(analysis: any, overrideSummary?: any, translatedLang?: string | null): string {
  const summary = overrideSummary ?? (analysis.summary || {});
  const lines: string[] = ['=== Property Information ==='];
  if (translatedLang) lines.push(`[Translated: ${translatedLang}]`);
  if (analysis.document_type) lines.push(`Type: ${analysis.document_type}`);
  if (analysis.addressNumber) lines.push(`Address: ${analysis.addressNumber} ${analysis.streetName} ${analysis.suffix}`);
  if (analysis.city) lines.push(`City: ${analysis.city}`);
  if (analysis.county) lines.push(`County: ${analysis.county}`);
  if (analysis.zipcode) lines.push(`Zipcode: ${analysis.zipcode}`);
  lines.push('', '=== Inspection Summary ===');
  for (const section of ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC", "Permits", "Pest Inspection", "Additional Notes"]) {
    if (summary[section]) {
      lines.push('', `--- ${section} ---`);
      lines.push(formatSectionAsText(section, summary[section]).split('\n').slice(1).join('\n'));
    }
  }
  return lines.join('\n');
}

function InspectionSection({ title, data }: { title: string; data: any }) {
  if (!data) return null;
  if (title === "Additional Notes" && typeof data === 'object') {
    return (
      <div className="space-y-2 rounded-lg border p-3 bg-card">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
        </div>
        {Object.entries(data).map(([area, findings]: [string, any]) => (
          <div key={area} className="space-y-1">
            <p className="text-xs font-semibold text-foreground">{area}</p>
            {typeof findings === 'string' ? (
              <p className="text-xs text-muted-foreground ml-2">{findings}</p>
            ) : typeof findings === 'object' && findings !== null ? (
              <div className="ml-2 space-y-0.5">
                {Object.entries(findings).map(([k, v]: [string, any]) => (
                  <div key={k}>
                    {Array.isArray(v) ? (
                      <ul className="list-disc ml-4 space-y-0.5">
                        {v.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground">{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground"><span className="font-medium">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border p-3 bg-card">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-primary">{title}</h4>
        <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
      </div>
      {data.condition && <p className="text-xs"><span className="font-medium">Condition:</span> <span className="text-muted-foreground">{data.condition}</span></p>}
      {data.age && <p className="text-xs"><span className="font-medium">Age:</span> <span className="text-muted-foreground">{data.age}</span></p>}
      {data.end_of_life && <p className="text-xs"><span className="font-medium">End of Life:</span> <span className="text-muted-foreground">{data.end_of_life}</span></p>}
      {data.issues && Array.isArray(data.issues) && data.issues.length > 0 && (
        <div>
          <p className="text-xs font-medium">Issues:</p>
          <ul className="list-disc ml-4 space-y-0.5">
            {data.issues.map((issue: string, i: number) => (
              <li key={i} className="text-xs text-muted-foreground">{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {data.recommendation && <p className="text-xs"><span className="font-medium">Recommendation:</span> <span className="text-muted-foreground">{data.recommendation}</span></p>}
      {data.recommendations && <p className="text-xs"><span className="font-medium">Recommendations:</span> <span className="text-muted-foreground">{data.recommendations}</span></p>}
      {data.notes && <p className="text-xs"><span className="font-medium">Notes:</span> <span className="text-muted-foreground">{data.notes}</span></p>}
    </div>
  );
}

export default function SharedAnalysisPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<{ name: string; ai_analysis: any } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState("es");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<any>(null);
  const [translatedLangLabel, setTranslatedLangLabel] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}/`)
      .then(async (res) => {
        if (!res.ok) throw new Error('This analysis link is invalid or no longer available.');
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  const handleTranslate = async () => {
    if (!data) return;
    setIsTranslating(true);
    setTranslateError(null);
    const lang = TRANSLATE_LANGUAGES.find(l => l.code === selectedLang)?.label ?? selectedLang;
    console.log(`[translate] starting: target=${selectedLang} (${lang})`);
    try {
      const translated = await translateSummary(data.ai_analysis.summary || {}, selectedLang, lang);
      console.log(`[translate] success`);
      setTranslatedSummary(translated);
      setTranslatedLangLabel(lang);
    } catch (err: any) {
      console.error(`[translate] error:`, err);
      setTranslateError(err.message);
    }
    setIsTranslating(false);
  };

  const handleExportPdf = async () => {
    if (!data || !reportRef.current) {
      setTranslateError("PDF export failed: could not find the report element.");
      return;
    }
    setIsExportingPdf(true);
    try {
      const { toJpeg } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");
      const analysis = data.ai_analysis;
      const addressStr = [analysis.addressNumber, analysis.streetName, analysis.suffix].filter(Boolean).join(' ');
      const dataUrl = await toJpeg(reportRef.current, { backgroundColor: "#ffffff", pixelRatio: 1, quality: 0.65 });
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });
      const pdfWidth = 612;
      const pdfHeight = Math.round((img.height / img.width) * pdfWidth);
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: [pdfWidth, pdfHeight] });
      pdf.addImage(dataUrl, "JPEG", 0, 0, pdfWidth, pdfHeight, "", "FAST");
      const langSuffix = translatedLangLabel ? ` - ${translatedLangLabel}` : "";
      const fileName = addressStr ? `${addressStr} - Property Brief${langSuffix}.pdf` : `Property Brief${langSuffix}.pdf`;
      pdf.save(fileName);
    } catch (err: any) {
      setTranslateError("PDF export failed: " + err.message);
    }
    setIsExportingPdf(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Property Brief</span>
        <span className="text-xs text-muted-foreground">Shared Analysis</span>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {!data && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {data && (() => {
          const analysis = data.ai_analysis;
          const summary = translatedSummary ?? (analysis.summary || {});
          const mainSections = ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC"];
          const otherSections = ["Permits", "Pest Inspection"];
          return (
            <div className="space-y-4">
              <div ref={reportRef} className="space-y-4 bg-background">
              <div className="rounded-lg border bg-primary/5 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-primary">Property Information</h3>
                  <div className="flex items-center gap-2">
                    {analysis.document_type && <Badge variant="secondary" className="text-[10px]">{analysis.document_type}</Badge>}
                    <CopyButton getText={() => formatAnalysisAsText(analysis, translatedSummary ?? undefined, translatedLangLabel)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {analysis.addressNumber && <p><span className="font-medium">Address:</span> {analysis.addressNumber} {analysis.streetName} {analysis.suffix}</p>}
                  {analysis.city && <p><span className="font-medium">City:</span> {analysis.city}</p>}
                  {analysis.county && <p><span className="font-medium">County:</span> {analysis.county}</p>}
                  {analysis.zipcode && <p><span className="font-medium">Zipcode:</span> {analysis.zipcode}</p>}
                  {analysis.fileName && <p className="col-span-2"><span className="font-medium">File:</span> {analysis.fileName}</p>}
                  {analysis.inspection_date && <p><span className="font-medium">Inspection Date:</span> {analysis.inspection_date}</p>}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold">
                    Inspection Summary
                    {translatedLangLabel && <span className="ml-2 text-[10px] font-normal text-muted-foreground">({translatedLangLabel})</span>}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <Select value={selectedLang} onValueChange={(v) => { setSelectedLang(v); setTranslatedSummary(null); setTranslatedLangLabel(null); }}>
                      <SelectTrigger className="h-6 text-[10px] w-36 px-2">
                        <Languages className="h-3 w-3 mr-1 shrink-0" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSLATE_LANGUAGES.map(l => (
                          <SelectItem key={l.code} value={l.code} className="text-xs">{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline" size="sm"
                      className="h-6 gap-1.5 px-2 text-[10px]"
                      onClick={handleTranslate}
                      disabled={isTranslating}
                    >
                      {isTranslating
                        ? <><RefreshCw className="h-3 w-3 animate-spin" />Translating…</>
                        : <><Languages className="h-3 w-3" />Translate (1 credit)</>}
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className="h-6 gap-1.5 px-2 text-[10px]"
                      onClick={handleExportPdf}
                      disabled={isExportingPdf}
                    >
                      {isExportingPdf
                        ? <><RefreshCw className="h-3 w-3 animate-spin" />Exporting…</>
                        : <><FileDown className="h-3 w-3" />Export PDF</>}
                    </Button>
                  </div>
                </div>
                {translateError && (
                  <p className="text-xs text-destructive">{translateError}</p>
                )}
                <div className="grid grid-cols-1 gap-3">
                  {mainSections.map(section => summary[section] && (
                    <InspectionSection key={section} title={section} data={summary[section]} />
                  ))}
                </div>
                {otherSections.map(section => summary[section] && (
                  <InspectionSection key={section} title={section} data={summary[section]} />
                ))}
                {summary["Additional Notes"] && (
                  <InspectionSection title="Additional Notes" data={summary["Additional Notes"]} />
                )}
              </div>
              </div>
            </div>
          );
        })()}
      </main>

      <footer className="border-t mt-12 px-6 py-4 text-center text-xs text-muted-foreground">
        Powered by Property Brief
      </footer>
    </div>
  );
}
