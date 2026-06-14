import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 22 §3 — the finalize sniff gate is the security boundary: a PENDING
 * upload becomes READY only when its real bytes match the declared type;
 * otherwise BOTH the object and the row are purged so the failed/malicious
 * upload never appears in any list. Soft-delete hides a row but keeps the
 * object (recoverable).
 */

interface DocRow {
  id: string;
  patientId: string;
  storageKey: string;
  mimeType: string;
  status: 'PENDING' | 'READY';
  active: boolean;
}

// vi.mock factories are hoisted above module scope, so the shared refs they
// close over must be created with vi.hoisted().
const h = vi.hoisted(() => {
  const headBytes = { current: new Uint8Array(16) };
  const dbState = { doc: null as DocRow | null };
  return { headBytes, dbState };
});

// withAudit reads the effective session for the actor; null actor → no audit
// write, which keeps these tests off the auditLog table.
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => null),
}));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'uploader1' } })) }));

const storageMock = vi.hoisted(() => ({
  getObjectHeadBytes: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
  presignDocumentPut: vi.fn(async () => 'https://s3.local/put'),
  getObjectBytes: vi.fn(async () => new Uint8Array(0)),
  SIGN_TTL_SECONDS: 900,
}));
vi.mock('../storage', () => storageMock);

const dbMock = vi.hoisted(() => ({
  db: {
    patientDocument: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => ({ id: 'pat1', role: 'PATIENT' })) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/db', () => dbMock);

const headBytes = h.headBytes;
const dbState = h.dbState;

const PDF = (() => {
  const b = new Uint8Array(16);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
  return b;
})();
const JPEG = (() => {
  const b = new Uint8Array(16);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
})();

import { finalizeDocument, softDeleteDocument } from '../services';

beforeEach(() => {
  vi.clearAllMocks();
  dbState.doc = {
    id: 'doc1',
    patientId: 'pat1',
    storageKey: 'patients/pat1/documents/doc1.pdf',
    mimeType: 'application/pdf',
    status: 'PENDING',
    active: true,
  };
  storageMock.getObjectHeadBytes.mockImplementation(async () => headBytes.current);
  dbMock.db.patientDocument.findUnique.mockImplementation(async () => dbState.doc);
  dbMock.db.patientDocument.update.mockImplementation(
    async ({ data }: { data: Partial<DocRow> }) => {
      if (dbState.doc) Object.assign(dbState.doc, data);
      return dbState.doc;
    },
  );
  dbMock.db.patientDocument.delete.mockImplementation(async () => {
    dbState.doc = null;
    return {};
  });
});

describe('finalizeDocument', () => {
  it('marks the row READY when the sniff matches the declared type', async () => {
    headBytes.current = PDF;
    const res = await finalizeDocument({ documentId: 'doc1' });
    expect(res.outcome).toBe('READY');
    expect(dbMock.db.patientDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'READY' } }),
    );
    expect(storageMock.deleteObject).not.toHaveBeenCalled();
    expect(dbMock.db.patientDocument.delete).not.toHaveBeenCalled();
  });

  it('purges object AND row when the bytes do not match the declared type', async () => {
    headBytes.current = JPEG; // declared application/pdf
    const res = await finalizeDocument({ documentId: 'doc1' });
    expect(res.outcome).toBe('REJECTED');
    expect(storageMock.deleteObject).toHaveBeenCalledWith('patients/pat1/documents/doc1.pdf');
    expect(dbMock.db.patientDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc1' } });
    expect(dbMock.db.patientDocument.update).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-READY row', async () => {
    dbState.doc!.status = 'READY';
    const res = await finalizeDocument({ documentId: 'doc1' });
    expect(res.outcome).toBe('READY');
    expect(storageMock.getObjectHeadBytes).not.toHaveBeenCalled();
    expect(dbMock.db.patientDocument.update).not.toHaveBeenCalled();
  });
});

describe('softDeleteDocument', () => {
  it('flips active=false and KEEPS the stored object', async () => {
    await softDeleteDocument({ documentId: 'doc1' });
    expect(dbMock.db.patientDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
    expect(storageMock.deleteObject).not.toHaveBeenCalled();
  });
});
