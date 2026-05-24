import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunView } from "@/lib/scraper/orchestrator";
import { RunViewer } from "./RunViewer";

export const dynamic = "force-dynamic";

export default async function ScraperRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let initial;
  try {
    initial = await getRunView(id);
  } catch {
    initial = null;
  }

  if (!initial) {
    notFound();
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 32px" }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/scraper"
          style={{
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: "var(--text-sm)",
          }}
        >
          ← все запуски
        </Link>
      </div>
      <RunViewer initial={initial} />
    </main>
  );
}
