'use client';
import type { AnalysisRecord } from '@/lib/types';
const NAME = 'youtube-video-analyzer';
const STORE = 'analyses';
const VERSION = 1;
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('이 브라우저는 로컬 저장을 지원하지 않습니다.')); return; }
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('videoId', 'video.id');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 접근 실패'));
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value: T | undefined;
    let resolved = false;
    tx.oncomplete = () => { db.close(); if (resolved) resolve(value as T); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('로컬 저장 오류')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('저장이 취소되었습니다.')); };
    run(tx.objectStore(STORE), v => { value = v; resolved = true; }, reject);
  });
}
export function saveRecord(record: AnalysisRecord) {
  return operation<void>('readwrite', (s, done) => { s.put(record); done(undefined); });
}
export function getRecord(id: string) {
  return operation<AnalysisRecord | undefined>('readonly', (s, done, fail) => {
    const r = s.get(id); r.onsuccess = () => done(r.result as AnalysisRecord | undefined); r.onerror = () => fail(r.error);
  });
}
export function listRecords() {
  return operation<AnalysisRecord[]>('readonly', (s, done, fail) => {
    const r = s.getAll();
    r.onsuccess = () => done((r.result as AnalysisRecord[]).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
    r.onerror = () => fail(r.error);
  });
}
export function deleteRecord(id: string) {
  return operation<void>('readwrite', (s, done) => { s.delete(id); done(undefined); });
}
export function clearRecords() {
  return operation<void>('readwrite', (s, done) => { s.clear(); done(undefined); });
}
