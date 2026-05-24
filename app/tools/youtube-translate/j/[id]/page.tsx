import JobView from "./JobView";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "32px 24px" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main style={wrap}>
      <a
        href="/tools/youtube-translate"
        style={{ color: "#79b8ff", fontSize: 13, textDecoration: "none" }}
      >
        ← новый перевод
      </a>
      <JobView jobId={id} />
    </main>
  );
}
