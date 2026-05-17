import Link from "next/link";
import { Glyph } from "@/components/ui/glyph";
import { Card, CardBody } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center p-8 bg-[var(--color-bg)]">
      <Card variant="surface" className="max-w-md w-full">
        <CardBody className="p-8 flex flex-col items-center gap-4 text-center">
          <span className="grid place-items-center size-16 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
            <Glyph name="Compass" size={28} className="text-subtle" />
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">404</span>
            <h1 className="text-hero">Nicht gefunden</h1>
            <p className="text-caption text-subtle max-w-sm">
              Diese Seite existiert nicht oder das Datum liegt außerhalb
              deines Datenfensters.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-2 text-[0.875rem] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Glyph name="Home" size={14} />
            Zur Startseite
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
