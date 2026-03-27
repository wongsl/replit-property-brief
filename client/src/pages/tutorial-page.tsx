export default function TutorialPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold tracking-tight">Tutorial</h2>
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
    </div>
  );
}
