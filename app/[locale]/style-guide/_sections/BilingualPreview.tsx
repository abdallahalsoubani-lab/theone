import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';

/**
 * Side-by-side LTR/RTL preview so visual QA happens without tab-switching.
 *
 * Each column declares its own `dir` and `font-*` so the rendering matches
 * what the user sees under that locale on a real page — even when this
 * component is rendered inside the other locale's tree.
 */
const sample = new Date('2026-06-01T14:30:00Z');

export function BilingualPreview() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-6 font-sans" dir="ltr">
          <Badge label="en · LTR" />
          <h3 className="text-xl font-medium text-brand-navy">The One for Physiotherapy</h3>
          <p className="text-sm text-brand-textMuted">
            Appointment with Dr. Sara on {formatDate(sample, 'en')} at 2:30 PM.
          </p>
          <p className="text-sm text-brand-textMuted">
            Patient phone: {formatPhone('+962790123456')}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-6 font-arabic" dir="rtl">
          <Badge label="ar · RTL" />
          <h3 className="text-xl font-medium text-brand-navy">المركز الأول للعلاج الطبيعي</h3>
          <p className="text-sm text-brand-textMuted">
            موعد مع د. سارة بتاريخ {formatDate(sample, 'ar')} الساعة 2:30 م.
          </p>
          <p className="text-sm text-brand-textMuted">
            هاتف المراجع: {formatPhone('+962790123456')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-navy">
      {label}
    </span>
  );
}
