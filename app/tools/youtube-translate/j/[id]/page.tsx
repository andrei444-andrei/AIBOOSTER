import Link from "next/link";
import JobView from "./JobView";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 32px" }}>
      <Link
        href="/tools/youtube-translate"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← новый перевод
      </Link>
      <JobView jobId={id} />
    </main>
  );
}
