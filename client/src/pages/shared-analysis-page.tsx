import React, { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

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

function formatAnalysisAsText(analysis: any): string {
  const summary = analysis.summary || {};
  const lines: string[] = ['=== Property Information ==='];
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
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
        </div>
        {Object.entries(data).map(([area, findings]: [string, any]) => (
          <div key={area} className="ml-3 space-y-1">
            <p className="text-xs font-semibold text-foreground">{area}</p>
            {typeof findings === 'string' ? (
              <p className="text-xs text-muted-foreground ml-2">{findings}</p>
            ) : typeof findings === 'object' && findings !== null ? (
              <div className="ml-2 space-y-0.5">
                {Object.entries(findings).map(([k, v]: [string, any]) => (
                  <p key={k} className="text-xs text-muted-foreground"><span className="font-medium">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}</p>
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
          const summary = analysis.summary || {};
          const mainSections = ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC"];
          const otherSections = ["Permits", "Pest Inspection"];
          return (
            <div className="space-y-4">
              <div className="rounded-lg border bg-primary/5 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-primary">Property Information</h3>
                  <div className="flex items-center gap-2">
                    {analysis.document_type && <Badge variant="secondary" className="text-[10px]">{analysis.document_type}</Badge>}
                    <CopyButton getText={() => formatAnalysisAsText(analysis)} />
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
                <h3 className="text-sm font-bold">Inspection Summary</h3>
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
          );
        })()}
      </main>

      <footer className="border-t mt-12 px-6 py-4 text-center text-xs text-muted-foreground">
        Powered by Property Brief
      </footer>
    </div>
  );
}
