import { AppShell } from "@/components/app-shell";
import { DocumentCenter } from "@/components/document-center";

export default function DocumentCenterPage() {
  return (
    <AppShell description="Uploaded files and generated documents across every domain." eyebrow="DOCUMENTS" title="Document Center">
      <DocumentCenter />
    </AppShell>
  );
}
