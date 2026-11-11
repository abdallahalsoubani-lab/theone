import { PatientDocumentsTab } from '@/components/patients/PatientDocumentsTab';
import { Card, CardContent } from '@/components/ui/card';
import { listDocuments } from '@/lib/patient-documents/queries';

/**
 * P64 #17 — attach files (X-rays, reports, Word letters) WHILE filling an
 * intake / pediatric assessment, without leaving for the patient file.
 * Staff-only by construction: it renders only on staff pages, and the upload
 * actions re-check `patient_documents.upload` + the care-team gate. Upload
 * only — deleting stays on the patient file's Documents tab.
 */
export async function AssessmentDocumentsCard({
  patientId,
  locale,
}: {
  patientId: string;
  locale: string;
}) {
  const documents = await listDocuments(patientId);
  return (
    <Card>
      <CardContent className="p-6">
        <PatientDocumentsTab
          patientId={patientId}
          locale={locale === 'ar' ? 'ar' : 'en'}
          documents={documents}
          canUpload
          canDelete={false}
        />
      </CardContent>
    </Card>
  );
}
