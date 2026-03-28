const FAQ = [
  // Pricing hidden — not yet launched
  // {
  //   q: "How much does one credit cost?",
  //   a: "Credits are available in two packages: 50 credits for $1.00, or 100 credits for $1.50. You can purchase credits from the Settings page at any time.",
  // },
  {
    q: "How many credits does analyzing a document use?",
    a: "Most documents use 1 credit. The AI reads the full text of your document in a single pass, which covers the vast majority of home inspection reports, disclosures, and pest reports.",
  },
  {
    q: "When does a document cost more than 1 credit?",
    a: "Very text-rich documents — typically large inspection reports with extensive written findings across many systems and pages — may exceed what can be analyzed in a single pass. In those cases the document is split into chunks and each chunk costs 1 credit. Before the analysis runs you will see a confirmation dialog telling you exactly how many credits will be used.",
  },
  {
    q: "How do I know in advance how many credits a document will use?",
    a: "When you click Analyze on a larger document, the app checks the document's text length first and shows you the exact credit cost before proceeding. You can cancel at that point at no charge.",
  },
  {
    q: "What types of documents are supported?",
    a: "Home Inspection Reports, Pest Inspection Reports, Natural Hazard Disclosures, Preliminary Title Reports, Seller Disclosures, HOA Documents, Roof Inspection Reports, Structural/Engineering Reports, HVAC Inspection Reports, Electrical Inspection Reports, and Plumbing Inspection Reports.",
  },
  {
    q: "What happens if I run out of credits?",
    a: "You can purchase more credits instantly from the Settings page, or request credits from an admin. Existing analyzed documents remain fully accessible — you only need credits to run new analyses.",
  },
];

export default function TutorialPage() {
  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-3xl font-display font-bold tracking-tight">Tutorial & FAQ</h2>
        <p className="text-muted-foreground">Learn how to upload and analyze your property documents.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">How to Upload & Analyze Documents</h3>
        <p className="text-sm text-muted-foreground">This video walks you through uploading property documents and using AI analysis to extract key details like address, inspection summaries, and more.</p>
      </div>
      <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-xl border shadow-sm">
        <iframe
          className="h-full w-full"
          src="https://www.youtube.com/embed/tiygQn3JXsU"
          title="Tutorial"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      <div className="space-y-4 max-w-4xl">
        <h3 className="text-lg font-semibold">Frequently Asked Questions</h3>
        <div className="divide-y rounded-xl border">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="px-5 py-4 space-y-1">
              <p className="text-sm font-medium">{q}</p>
              <p className="text-sm text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
