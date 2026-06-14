import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

type PdfDocElement = Parameters<typeof pdf>[0];

/**
 * Shared layout for the clinical report PDFs (Prompt 22 §2) — session report
 * and treatment plan. Mirrors the pediatric-assessment renderer's brand
 * styling. A section is either a list of label/value rows or a free-text body
 * paragraph (for SOAP narrative blocks).
 */

export interface ReportRow {
  label: string;
  value: string;
}
export interface ReportSection {
  heading: string;
  rows?: ReportRow[];
  body?: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 10, color: '#212940' },
  header: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DEE8',
  },
  clinicName: { fontSize: 16, fontWeight: 700, color: '#212940' },
  meta: { fontSize: 9, color: '#5A6580', marginTop: 4 },
  section: { marginTop: 12 },
  h2: { fontSize: 12, fontWeight: 700, color: '#0EA5B7', marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 2 },
  rowLabel: { width: 150, color: '#5A6580' },
  rowValue: { flex: 1 },
  body: { lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#5A6580',
    textAlign: 'center',
  },
});

export function ReportDocument({
  ar,
  title,
  meta,
  sections,
}: {
  ar: boolean;
  title: string;
  meta: string;
  sections: ReportSection[];
}): ReactElement {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinicName}>
            {ar ? 'المركز الأول للعلاج الطبيعي' : 'The One for Physiotherapy'}
          </Text>
          <Text style={styles.meta}>{title}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        {sections.map((s, i) => (
          <View key={i} style={styles.section} wrap={false}>
            <Text style={styles.h2}>{s.heading}</Text>
            {s.body !== undefined && <Text style={styles.body}>{s.body || '—'}</Text>}
            {(s.rows ?? []).map((r, j) => (
              <View key={j} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.footer} fixed>
          {ar
            ? 'وثيقة سريرية — للاستخدام داخل العيادة فقط.'
            : 'Clinical document — for in-clinic use only.'}
        </Text>
      </Page>
    </Document>
  );
}

/** Render a react-pdf document element to a complete Buffer. */
export async function renderReportToBuffer(element: PdfDocElement): Promise<Buffer> {
  const stream = await pdf(element).toBuffer();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (stream as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
    (stream as unknown as NodeJS.ReadableStream).on('end', () => resolve());
    (stream as unknown as NodeJS.ReadableStream).on('error', reject);
  });
  return Buffer.concat(chunks);
}
