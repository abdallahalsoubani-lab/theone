import { Document, Page, StyleSheet, View } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

import { PDF_FONT_FAMILY, pdfDir } from './fonts';
import { PdfText } from './render';

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
  page: { padding: 36, fontFamily: PDF_FONT_FAMILY, fontSize: 10, color: '#212940' },
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
  const d = pdfDir(ar);
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <PdfText style={[styles.clinicName, d.text]}>
            {ar ? 'المركز الأول للعلاج الطبيعي' : 'The One for Physiotherapy'}
          </PdfText>
          <PdfText style={[styles.meta, d.text]}>{title}</PdfText>
          <PdfText style={[styles.meta, d.text]}>{meta}</PdfText>
        </View>
        {sections.map((s, i) => (
          <View key={i} style={styles.section} wrap={false}>
            <PdfText style={[styles.h2, d.text]}>{s.heading}</PdfText>
            {s.body !== undefined && (
              <PdfText style={[styles.body, d.text]}>{s.body || '—'}</PdfText>
            )}
            {(s.rows ?? []).map((r, j) => (
              <View key={j} style={[styles.row, d.row]}>
                <PdfText style={[styles.rowLabel, d.text]}>{r.label}</PdfText>
                <PdfText style={[styles.rowValue, d.text]}>{r.value}</PdfText>
              </View>
            ))}
          </View>
        ))}
        <PdfText style={[styles.footer, d.center]} fixed>
          {ar
            ? 'وثيقة سريرية — للاستخدام داخل العيادة فقط.'
            : 'Clinical document — for in-clinic use only.'}
        </PdfText>
      </Page>
    </Document>
  );
}
