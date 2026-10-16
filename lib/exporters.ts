'use client';
import type { AnalysisRecord, AnalysisContent,GroundedItem,TranscriptLine } from '@/lib/types';
import { timestamp } from '@/lib/youtube';
import { timelineTime } from '@/lib/timeline-granularity';
import {timelineStartSeconds} from '@/lib/timeline-accuracy';
import {readableCaptionTimeline} from '@/lib/caption-reading-flow';
function section(name:string, items:GroundedItem[], evidence:AnalysisRecord['evidence']){
  return `## ${name}\n\n`+items.map(i=>{
    const sources=i.evidenceIds.map(id=>evidence.find(e=>e.id===id)).filter((e):e is NonNullable<typeof e>=>Boolean(e));
    return `${i.title?`### ${i.title}\n\n`:''}${i.text}\n\n${sources.length?`영상 근거: ${sources.map(e=>`${timestamp(e.startSeconds)}–${timestamp(e.endSeconds)}`).join(', ')}\n`:''}${i.edited?'(사용자 편집본 · 원본 대조 필요)\n':''}`;
  }).join('\n');
}
function timelineSection(items:GroundedItem[], evidence:AnalysisRecord['evidence'], captionSource:boolean) {
  const lookup = new Map(evidence.map(item=>[item.id,item]));
  const readingItems=captionSource
    ? readableCaptionTimeline(items,evidence)
    : items;

  const entries = readingItems.map(item=>{
    const refs=item.evidenceIds.map(id=>lookup.get(id)).filter((e):e is NonNullable<typeof e>=>Boolean(e));
    const start=timelineStartSeconds(item,evidence);
    return {item,refs,start};
  }).sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));
  return `## 타임라인\n\n> ${captionSource?'사용자가 제공한 시간 지정 자막의 구간 시작 시각입니다. 자막 자체의 정확성은 원본과 비교하세요.':'AI 추정 시각: 실제 발화와 몇 초 단위로 일치하는지는 검증되지 않았습니다. 수정된 항목은 사용자 지정 시각입니다.'}\n\n`+entries.map(({item,refs,start})=>{
    const heading=start===null?'시간 미확인':timelineTime(start);
    const timeLabel=item.timeOverrideSeconds!==undefined?' (사용자 수정 시각)':'';
    const more=refs.filter(e=>start!==null && Math.abs(e.startSeconds-start)>1);
    return `**${heading}${timeLabel}** ${item.title?`**${item.title}** — `:''}${item.text}${more.length?`\n\n추가 근거: ${more.map(e=>timelineTime(e.startSeconds)).join(', ')}`:''}${item.edited?'\n\n(사용자 편집본 · 원본 대조 필요)':''}`;
  }).join('\n\n')+'\n\n';
}
export function toMarkdown(record:AnalysisRecord){const c=record.edited;return `# ${record.video.title}\n\n원본 영상: ${record.video.url}\n채널: ${record.video.channel}\n분석일: ${new Date(record.createdAt).toLocaleString('ko-KR')}\nAI 모델: ${record.model}\n\n> AI 생성 정보는 반드시 원본과 대조하세요. 시간 지정 자막은 발언·시각의 출처이며 실제 음성과의 완전한 일치를 보증하지 않습니다.\n\n${section('핵심 요약',c.summary,record.evidence)}\n${timelineSection(c.timeline,record.evidence,(record.analysisMeta?.sourceMode==='user-captions'||record.analysisMeta?.sourceMode==='public-captions'))}\n${section('상세 아티클',c.article,record.evidence)}\n## 스크립트\n\n${c.transcript.length?c.transcript.map(t=>`[${timestamp(t.startSeconds)}] ${t.text}${t.translated?' (번역)':''}${t.edited?' (사용자 편집)':''}`).join('\n\n'):'원문 전사를 확보하지 못해 스크립트를 제공하지 않습니다.'}\n\n## 확인되지 않아 제외한 내용\n\n${c.exclusions.length?c.exclusions.map(v=>'- '+v).join('\n'):'특별히 기록된 항목 없음'}\n`;}
export function toPlainText(record:AnalysisRecord){return toMarkdown(record).replace(/^#{1,3}\s*/gm,'').replace(/^>\s?/gm,'').replace(/\*\*/g,'');}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
function safeName(s:string){return s.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70)||'youtube-analysis'}
function filename(r:AnalysisRecord,extension:string){return `${safeName(r.video.title)}-${r.video.id}.${extension}`}
export function exportText(record:AnalysisRecord,kind:'md'|'txt'){const content=kind==='md'?toMarkdown(record):toPlainText(record);downloadBlob(new Blob(['\uFEFF',content],{type:kind==='md'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'}),filename(record,kind));}
function encode(s:string){return new TextEncoder().encode(s)}
function xmlEscape(v:string){return v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
// Small interoperable ZIP STORE writer: DOCX is a ZIP of OpenXML parts, no runtime dependency.
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0}
function zip(files:{name:string;data:Uint8Array}[]){const chunks:Uint8Array[]=[];const dir:Uint8Array[]=[];let offset=0;
function header(n:number){return new Uint8Array(n)}
function u16(a:Uint8Array,i:number,v:number){new DataView(a.buffer).setUint16(i,v,true)}
function u32(a:Uint8Array,i:number,v:number){new DataView(a.buffer).setUint32(i,v,true)}
for(const file of files){const name=encode(file.name),size=file.data.length,crc=crc32(file.data);const h=header(30+name.length);u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x0800);u32(h,14,crc);u32(h,18,size);u32(h,22,size);u16(h,26,name.length);h.set(name,30);chunks.push(h,file.data);
const d=header(46+name.length);u32(d,0,0x02014b50);u16(d,4,20);u16(d,6,20);u16(d,8,0x0800);u32(d,16,crc);u32(d,20,size);u32(d,24,size);u16(d,28,name.length);u32(d,42,offset);d.set(name,46);dir.push(d);offset+=h.length+size;}
const dirLen=dir.reduce((s,c)=>s+c.length,0);const end=header(22);u32(end,0,0x06054b50);u16(end,8,files.length);u16(end,10,files.length);u32(end,12,dirLen);u32(end,16,offset);return new Blob([...chunks,...dir,end] as BlobPart[],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
export function exportDocx(record:AnalysisRecord){const lines=toPlainText(record).split('\n');const paragraphs=lines.map(line=>`<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Malgun Gothic" w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join('');
const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
const files=[{name:'[Content_Types].xml',data:encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')},{name:'_rels/.rels',data:encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')},{name:'word/document.xml',data:encode(doc)}];downloadBlob(zip(files),filename(record,'docx'));
}
// Raster A4 PDF: canvas renders Korean using fonts installed in visitor's browser.
// Avoids distributing third-party fonts; text is not selectable in this basic PDF.
export async function exportPdf(record:AnalysisRecord){const content=toPlainText(record);const rawLines=content.split('\n');const pages:string[][]=[];let lines:string[]=[];
const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이 브라우저에서는 PDF를 만들 수 없습니다.');ctx.fillStyle='#fff';ctx.font='28px Arial, Malgun Gothic, sans-serif';
for(const text of rawLines){let rest=text||' ';while(rest.length){let end=rest.length;while(end>1&&ctx.measureText(rest.slice(0,end)).width>1100)end--;const segment=rest.slice(0,end);lines.push(segment);rest=rest.slice(end);if(lines.length>=43){pages.push(lines);lines=[];if(pages.length>=150)throw new Error('PDF가 너무 깁니다. TXT 또는 Word로 다운로드해주세요.');}}}
if(lines.length)pages.push(lines);if(!pages.length)pages.push([' ']);const imageBytes:Uint8Array[]=[];
for(const page of pages){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111827';ctx.font='28px Arial, Malgun Gothic, sans-serif';page.forEach((line,i)=>ctx.fillText(line,70,105+i*37));const b64=canvas.toDataURL('image/jpeg',0.87).split(',')[1];const binary=atob(b64);const arr=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)arr[i]=binary.charCodeAt(i);imageBytes.push(arr);}
const pieces:Uint8Array[]=[encode('%PDF-1.4\n')];const offsets:number[]=[0];let length=pieces[0].length;
function obj(id:number,head:string,bytes?:Uint8Array,tail=''){offsets[id]=length;const a=encode(`${id} 0 obj\n${head}`);pieces.push(a);length+=a.length;if(bytes){pieces.push(bytes);length+=bytes.length;}const b=encode(tail+'\nendobj\n');pieces.push(b);length+=b.length;}
const total=2+pages.length*3;obj(1,`<< /Type /Catalog /Pages 2 0 R >>`);obj(2,`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${pages.length} >>`);
for(let i=0;i<pages.length;i++){const p=3+i*3,im=p+1,contents=p+2;obj(p,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${contents} 0 R >>`);const jpeg=imageBytes[i];obj(im,`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,jpeg,'\nendstream');const stream=`q 595 0 0 842 0 0 cm /Im${i} Do Q`;obj(contents,`<< /Length ${encode(stream).length} >>\nstream\n${stream}\nendstream`);}
const xref=length;let s=`xref\n0 ${total+1}\n0000000000 65535 f \n`;for(let i=1;i<=total;i++)s+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;s+=`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;pieces.push(encode(s));downloadBlob(new Blob(pieces as BlobPart[],{type:'application/pdf'}),filename(record,'pdf'));
}
export function setEdited(content:AnalysisContent,tab:'summary'|'timeline'|'article'|'transcript',id:string,text:string):AnalysisContent{
  const list=content[tab] as (GroundedItem|TranscriptLine)[];
  return {...content,[tab]:list.map(v=>v.id===id?{...v,text,edited:true}:v)};
}
