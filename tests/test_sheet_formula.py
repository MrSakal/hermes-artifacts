"""The sheet formula engine (types/sheet/formula.js), run under node against a two-sheet fixture."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMULA = ROOT / "plugin" / "hermes_artifacts" / "types" / "sheet" / "formula.js"
NODE = shutil.which("node")

SCRIPT = r"""
const F = require(process.argv[2]);
const E = (c) => ({ error: c });
const out = {};
function same(got, want) {
  if (typeof want === 'number' && typeof got === 'number') return Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
  return JSON.stringify(got) === JSON.stringify(want);
}
function group(name, cases, run) {
  const fails = [];
  cases.forEach((c) => {
    let got;
    try { got = run(c); } catch (e) { got = 'THROW ' + (e && e.stack || e); }
    if (!same(got, c[c.length - 1])) fails.push([JSON.stringify(c.slice(0, -1)), JSON.stringify(got), JSON.stringify(c[c.length - 1])]);
  });
  out[name] = { n: cases.length, fails };
}

// ---- fixture: sheet "Data" and "My Sheet"
const rows = [
  ['Item', 'Price', 'Qty', 'Date', 'Cat', '=F2', '=1/0', '=G1+1', null, 10, 'a', 30, -100],
  ['Apple', 1.5, 10, '2026-01-15', 'fruit', '=F1', null, null, null, 20, 'b', 20, 60],
  ['Banana', 0.25, 20, '2026-02-28', 'fruit', null, null, null, null, 30, 'c', 10, 60],
  ['Carrot', 2, 5, '2026-03-01', 'veg', null, null, null, null, 40, 'd'],
  ['Date', '3', null, '2024-02-29', 'fruit', null, null, null, null, 50, 'e'],
  ['apple pie', 4, true, null, 'dessert'],
];
const data = {};
rows.forEach((r, i) => r.forEach((v, j) => { if (v !== null) data[F.colName(j) + (i + 1)] = v; }));
Object.assign(data, { A20: 1, B20: 2, C20: 3 });
const book = {
  Data: data,
  'My Sheet': { A1: 100, A2: 200, B1: '=Data!B2*2', C1: "='My Sheet'!A1+A2" },
};

const T = [
  // operators and precedence
  ['=1+2*3', 7], ['=(1+2)*3', 9], ['=2^3^2', 64], ['=-2^2', 4], ['=2*-3', -6], ['=10%', 0.1], ['=50%*2', 1],
  ['=1+2&3', '33'], ['="a"&1.5', 'a1.5'], ['=7-2-1', 4], ['=8/2/2', 2], ['=1=1', true], ['="abc"="ABC"', true],
  ['="a"<"B"', true], ['=1<"a"', true], ['=TRUE>1', true], ['=2<>3', true], ['=3>=3', true], ['=0.1+0.2=0.3', true],
  ['=0.1+0.2', 0.3], ['=TRUE+TRUE', 2], ['=C5+1', 1], ['=C5&"x"', 'x'], ['=B5+1', 4], ['=A2+1', E('#VALUE!')], ['=+5', 5],
  ['="x"&TRUE', 'xTRUE'], ['="x"&1/4', 'x0.25'], ['= 1 + 2 ', 3], ['=C5', 0], ['=(J1:J3)*2', 20],
  // references
  ['=Data!B2', 1.5], ["='My Sheet'!A1", 100], ["='my sheet'!A2", 200], ['=Nope!A1', E('#REF!')], ['=$B$2+B$3', 1.75],
  ["=SUM('My Sheet'!A1:A2)", 300], ["='My Sheet'!B1", 3], ["='My Sheet'!C1", 300], ['=SUM(J:J)', 150], ['=SUM(20:20)', 6],
  ['=SUM(J1:J2:J5)', 150], ['=SUM(J1:INDEX(J1:J5,5))', 150], ['=SUM(A1:J1)', E('#CYCLE!')],
  // errors
  ['=1/0', E('#DIV/0!')], ['=G1', E('#DIV/0!')], ['=H1', E('#DIV/0!')], ['=IFERROR(G1,"x")', 'x'], ['=IFERROR(5,"x")', 5],
  ['=IFNA(NA(),1)', 1], ['=IFNA(VLOOKUP("zz",A2:B6,2,FALSE),"none")', 'none'], ['=IFNA(G1,1)', E('#DIV/0!')],
  ['=ISERROR(G1)', true], ['=ISERROR(1)', false], ['=SUM(B2,G1)', E('#DIV/0!')], ['=FOO(1)', E('#NAME?')], ['=xyz', E('#NAME?')],
  ['=SQRT(-1)', E('#NUM!')], ['=F1', E('#CYCLE!')], ['=F2+1', E('#CYCLE!')], ['=1+', E('#NAME?')], ['=#N/A', E('#N/A')],
  ['=#REF!+1', E('#REF!')], ['=Data!#REF!', E('#REF!')], ['=ISERROR(#VALUE!)', true], ['=ROUND(1)', E('#VALUE!')],
  // math
  ['=SUM(B2:B6)', 7.75], ['=SUM(B5,1)', 1], ['=SUM("3",1)', 4], ['=SUM(C2:C6)', 35], ['=SUM(TRUE,1)', 2], ['=AVERAGE(B2:B6)', 1.9375],
  ['=MIN(B2:B6)', 0.25], ['=MAX(B2:B6)', 4], ['=COUNT(B2:B6)', 4], ['=COUNTA(B2:B6)', 5], ['=COUNTBLANK(C2:C6)', 1],
  ['=PRODUCT(C2:C4)', 1000], ['=MEDIAN(1,3,2,4)', 2.5], ['=STDEV(2,4,4,4,5,5,7,9)', 2.138089935299395],
  ['=VAR(2,4,4,4,5,5,7,9)', 4.571428571428571], ['=ROUND(2.345,2)', 2.35], ['=ROUND(1.005,2)', 1.01], ['=ROUND(-2.5,0)', -3],
  ['=ROUND(1234,-2)', 1200], ['=ROUNDUP(3.21,1)', 3.3], ['=ROUNDUP(-3.21,1)', -3.3], ['=ROUNDUP(0.1*3,1)', 0.3],
  ['=ROUNDDOWN(3.29,1)', 3.2], ['=INT(-3.5)', -4], ['=ABS(-2)', 2], ['=SQRT(16)', 4], ['=POWER(2,10)', 1024], ['=MOD(-3,2)', 1],
  ['=MOD(5,0)', E('#DIV/0!')], ['=CEILING(4.3,1)', 5], ['=CEILING(4.3,0.5)', 4.5], ['=FLOOR(4.7,2)', 4], ['=SIGN(-3)', -1],
  ['=ROUND(PI(),4)', 3.1416], ['=AND(RAND()>=0,RAND()<1)', true], ['=RANDBETWEEN(5,5)', 5], ['=AVERAGE(C5)', E('#DIV/0!')],
  ['=SUM(J1:J3*2)', 120], ['=SUMPRODUCT(B2:B4,C2:C4)', 30], ['=SUMPRODUCT((E2:E6="fruit")*(C2:C6))', 30],
  ['=SUMPRODUCT(--(B2:B6>1))', 4], ['=SZUM(J1:J5)', 150],
  // logic
  ['=IF(B2>1,"hi","lo")', 'hi'], ['=IF(FALSE,1)', false], ['=IF(B5,1,2)', E('#VALUE!')], ['=IF(1,,)', 0],
  ['=IF(TRUE,1,1/0)', 1], ['=IFS(B2>5,"a",B2>1,"b")', 'b'], ['=IFS(FALSE,1)', E('#N/A')], ['=AND(TRUE,1)', true],
  ['=OR(FALSE,0)', false], ['=NOT(0)', true], ['=XOR(TRUE,TRUE,TRUE)', true], ['=SWITCH(E4,"fruit",1,"veg",2,0)', 2],
  ['=SWITCH(9,1,2)', E('#N/A')], ['=SWITCH(9,1,2,"d")', 'd'], ['=ISBLANK(C5)', true], ['=ISBLANK(C2)', false],
  ['=ISNUMBER(B5)', false], ['=ISNUMBER(D2)', true], ['=ISTEXT(A2)', true], ['=AND(C2:C6)', true],
  // criteria and wildcards
  ['=SUMIF(E2:E6,"fruit",B2:B6)', 1.75], ['=COUNTIF(E2:E6,"fruit")', 3], ['=COUNTIF(E2:E6,"FRUIT")', 3],
  ['=COUNTIF(B2:B6,">1")', 3], ['=COUNTIF(B2:B6,3)', 1], ['=COUNTIF(A2:A6,"a*")', 2], ['=COUNTIF(A2:A6,"?pple")', 1],
  ['=COUNTIF(E2:E6,"<>fruit")', 2], ['=COUNTIF(C2:C6,"")', 1], ['=COUNTIF(C2:C6,"<>")', 4], ['=COUNTIF(A2:A6,"~*")', 0],
  ['=COUNTIF(D2:D6,">2026-01-31")', 2], ['=COUNTIF(D2:D6,">"&DATE(2026,1,31))', 2], ['=COUNTIF(J1:J5,">=30")', 3],
  ['=COUNTIF(K1:K5,">b")', 3], ['=SUMIF(J1:J5,">20")', 120], ['=SUMIFS(C2:C6,E2:E6,"fruit",B2:B6,">0.5")', 10],
  ['=COUNTIFS(E2:E6,"fruit",C2:C6,">=10")', 2], ['=AVERAGEIF(E2:E6,"fruit",C2:C6)', 15], ['=AVERAGEIFS(C2:C6,E2:E6,"veg")', 5],
  ['=MAXIFS(C2:C6,E2:E6,"fruit")', 20], ['=MINIFS(C2:C6,E2:E6,"fruit")', 10], ['=SUMIF(E:E,"fruit",C:C)', 30],
  ['=COUNTIF(C2:C6,TRUE)', 1], ['=AVERAGEIF(E2:E6,"none",C2:C6)', E('#DIV/0!')],
  // lookups
  ['=VLOOKUP("banana",A2:C6,3,FALSE)', 20], ['=VLOOKUP("zz",A2:B6,2,FALSE)', E('#N/A')], ['=VLOOKUP(35,J1:K5,2)', 'c'],
  ['=VLOOKUP(35,J1:K5,2,TRUE)', 'c'], ['=VLOOKUP(5,J1:K5,2)', E('#N/A')], ['=VLOOKUP(99,J1:K5,2)', 'e'],
  ['=VLOOKUP("car*",A2:B6,2,FALSE)', 2], ['=VLOOKUP(30,J1:K5,3,FALSE)', E('#REF!')], ['=VLOOKUP("Apple",A:C,2,FALSE)', 1.5],
  ['=HLOOKUP("Qty",A1:C6,3,FALSE)', 20], ['=MATCH(30,J1:J5,0)', 3], ['=MATCH(35,J1:J5)', 3], ['=MATCH(35,J1:J5,1)', 3],
  ['=MATCH("C",K1:K5,0)', 3], ['=MATCH(99,J1:J5,0)', E('#N/A')], ['=MATCH(25,L1:L3,-1)', 1], ['=MATCH("b?",K1:K5,0)', E('#N/A')],
  ['=XLOOKUP("Carrot",A2:A6,C2:C6)', 5], ['=XLOOKUP("x",A2:A6,C2:C6,"none")', 'none'], ['=XLOOKUP("x",A2:A6,C2:C6)', E('#N/A')],
  ['=XLOOKUP(35,J1:J5,K1:K5,,-1)', 'c'], ['=XLOOKUP(35,J1:J5,K1:K5,,1)', 'd'], ['=XLOOKUP("fruit",E2:E6,A2:A6,,0,-1)', 'Date'],
  ['=XLOOKUP("b*",A2:A6,B2:B6,,2)', 0.25], ['=XLOOKUP("Qty",A1:E1,A4:E4)', 5], ['=SUM(XLOOKUP("Banana",A2:A6,B2:C6))', 20.25],
  ['=INDEX(A2:C6,2,3)', 20], ['=INDEX(J1:J5,4)', 40], ['=INDEX(J1:K5,2,2)', 'b'], ['=SUM(INDEX(J1:K5,0,1))', 150],
  ['=INDEX(J1:J5,9)', E('#REF!')], ['=INDEX(A1:E1,3)', 'Qty'], ['=CHOOSE(2,"a","b","c")', 'b'], ['=SUM(CHOOSE(1,J1:J5,L1:L3))', 150],
  ['=CHOOSE(5,1,2)', E('#VALUE!')], ['=ROW(B5)', 5], ['=COLUMN(D1)', 4], ['=ROWS(A2:C6)', 5], ['=COLUMNS(A2:C6)', 3],
  ['=ROW(INDEX(J1:J5,3))', 3], ['=ROW()>=100', true], ['=ROWS(J:J)', 6],
  // text
  ['=CONCAT(A2," ",E2)', 'Apple fruit'], ['=CONCAT(J1:J3)', '102030'], ['=CONCATENATE("a",1,TRUE)', 'a1TRUE'],
  ['=TEXTJOIN(", ",TRUE,A2:A4,C5)', 'Apple, Banana, Carrot'], ['=TEXTJOIN("-",FALSE,"a",C5,"b")', 'a--b'],
  ['=LEFT("Hello",2)', 'He'], ['=LEFT("Hello")', 'H'], ['=RIGHT("Hello",3)', 'llo'], ['=MID("Hello",2,3)', 'ell'],
  ['=LEN("Hello")', 5], ['=LEN(C5)', 0], ['=LEN(123.5)', 5], ['=LOWER("AbC")', 'abc'], ['=UPPER("abc")', 'ABC'],
  ['=PROPER("hello wORLD")', 'Hello World'], ['=TRIM("  a   b  ")', 'a b'], ['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
  ['=SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'], ['=REPLACE("abcdef",2,3,"X")', 'aXef'], ['=FIND("b","abcb")', 2],
  ['=FIND("b","abcb",3)', 4], ['=FIND("B","abc")', E('#VALUE!')], ['=SEARCH("B","abc")', 2], ['=SEARCH("c?","abcd")', 3],
  ['=TEXT(1234.5,"#,##0.00")', '1,234.50'], ['=TEXT(0.256,"0.0%")', '25.6%'], ['=TEXT(D2,"yyyy.mm.dd.")', '2026.01.15.'],
  ['=TEXT("2026-11-10","dd/mm/yyyy")', '10/11/2026'], ['=TEXT(B5,"0.00")', '3.00'], ['=VALUE("12.5")', 12.5],
  ['=VALUE("abc")', E('#VALUE!')], ['=VALUE("1,234")', 1234], ['=REPT("ab",3)', 'ababab'], ['=EXACT("a","A")', false],
  ['=LEFT(G1,1)', E('#DIV/0!')], ['=UPPER(KISBETŰ("X"))', 'X'],
  // dates
  ['=DATE(2026,11,10)', '2026-11-10'], ['=DATE(2026,13,1)', '2027-01-01'], ['=DATE(2026,3,0)', '2026-02-28'],
  ['=YEAR(D2)', 2026], ['=MONTH(D3)', 2], ['=DAY(D4)', 1], ['=D4-D3', 1], ['=D2+1', '2026-01-16'], ['=D2+0.5', '2026-01-15T12:00'],
  ['=D2*1', 46037], ['=DATE(1900,3,1)*1', 61], ['=DATE(1900,1,1)*1', 1], ['=DATE(1900,2,28)*1', 59],
  ['=WEEKDAY(DATE(2026,11,10))', 3], ['=WEEKDAY(DATE(2026,11,10),2)', 2], ['=WEEKDAY(DATE(2026,11,10),3)', 1],
  ['=WEEKNUM(DATE(2026,1,1))', 1], ['=WEEKNUM(DATE(2026,1,4))', 2], ['=WEEKNUM(DATE(2026,1,4),2)', 1],
  ['=WEEKNUM(DATE(2026,1,1),21)', 1], ['=WEEKNUM(DATE(2027,1,1),21)', 53], ['=EDATE("2026-01-31",1)', '2026-02-28'],
  ['=EDATE("2026-03-15",-3)', '2025-12-15'], ['=EOMONTH("2026-01-15",1)', '2026-02-28'], ['=EOMONTH("2024-01-15",1)', '2024-02-29'],
  ['=DATEDIF("2024-02-29","2026-03-01","Y")', 2], ['=DATEDIF("2026-01-15","2026-03-01","M")', 1], ['=DATEDIF(D2,D4,"D")', 45],
  ['=DATEDIF("2024-02-29","2026-03-01","YM")', 0], ['=DATEDIF("2026-01-20","2026-03-05","MD")', 13],
  ['=DATEDIF(D4,D2,"D")', E('#NUM!')], ['=DAYS("2026-03-01","2026-01-15")', 45], ['=NETWORKDAYS("2026-11-09","2026-11-15")', 5],
  ['=NETWORKDAYS("2026-11-09","2026-11-15","2026-11-10")', 4], ['=YEAR(TODAY())>=2026', true], ['=ISNUMBER(NOW())', true],
  ['=TODAY()-TODAY()', 0], ['=D2>DATE(2026,1,1)', true], ['=D2>46000', true], ['=D2=DATE(2026,1,15)', true],
  ['=MAX(D2:D5)', 46082], ['=VLOOKUP(DATE(2026,2,28),D2:E6,2,FALSE)', 'fruit'], ['=YEAR("x")', E('#VALUE!')],
  // finance
  ['=PMT(0.05/12,60,10000)', -188.71233644010877], ['=FV(0.05,10,-100)', 1257.7892535548839], ['=PV(0.05,10,-100)', 772.1734929184818],
  ['=NPV(0.1,100,200)', 256.198347107438], ['=IRR(M1:M3)', 0.13066238629180732], ['=PMT(0,10,100)', -10],
];
const keys = {};
T.forEach((t, i) => { const k = 'Z' + (100 + i); data[k] = t[0]; keys[i] = k; });
const names = () => Object.keys(book);
const wb = F.workbook((s, k) => book[s][k], names, (s) => ({ rows: s === 'Data' ? 6 : 2, cols: 26 }));
group('formulas', T.map((t, i) => [t[0], i, t[1]]), (c) => wb.value('data', keys[c[1]]));
// cross-sheet value, invalidation
const extra = [];
extra.push(['value My Sheet!C1', wb.value('My Sheet', 'C1'), 300]);
book['My Sheet'].A1 = 1; wb.invalidate();
extra.push(['after invalidate', wb.value('My Sheet', 'C1'), 201]);
extra.push(['unknown sheet', wb.value('Nope', 'A1'), E('#REF!')]);
extra.push(['plain cell', wb.value('Data', 'A2'), 'Apple']);
extra.push(['empty cell', wb.value('Data', 'Y1'), null]);
extra.push(['hu concat', F.workbook((s, k) => ({ A1: '="x"&1.5&TRUE' })[k], () => ['S'], { locale: 'hu' }).value('S', 'A1'), 'x1,5IGAZ']);
const big = F.workbook((s, k) => (k === 'A1' ? '=SUM(B:B)' : k === 'B4999' ? 2 : k === 'B7' ? 3 : undefined), () => ['S']);
extra.push(['whole column default bound', big.value('S', 'A1'), 5]);
// a long cycle beyond the recursion window
const cyc = {};
for (let i = 1; i <= 600; i++) cyc['A' + i] = '=A' + (i === 600 ? 1 : i + 1) + '+1';
const wc = F.workbook((s, k) => cyc[k], () => ['S']);
extra.push(['long cycle', wc.value('S', 'A300'), E('#CYCLE!')]);
group('workbook', extra, (c) => c[1]);

group('format', [
  [1234.5, '#,##0.00', 'en', '1,234.50'], [1234.5, '#,##0.00', 'hu', '1 234,50'], [1200, '#,##0 "Ft"', 'hu', '1 200 Ft'],
  [1200, '#,##0 "Ft"', 'en', '1,200 Ft'], [-1234.5, '$#,##0.00', 'en', '-$1,234.50'], [1234.5, '#,##0.00 €', 'hu', '1 234,50 €'],
  [0.256, '0.0%', 'en', '25.6%'], [0.256, '0.0%', 'hu', '25,6%'], [0.5, '0%', 'en', '50%'], [3.14159, '0.00', 'en', '3.14'],
  [2.5, '0', 'en', '3'], [-0.001, '0.00', 'en', '0.00'], [1234567, '#,##0', 'en', '1,234,567'], [1234567, '#,##0', 'hu', '1 234 567'],
  [null, '0.00', 'en', ''], [true, null, 'hu', 'IGAZ'], [false, null, 'en', 'FALSE'], [{ error: '#N/A' }, '0', 'en', '#N/A'],
  [0.1 + 0.2, null, 'en', '0.3'], [1 / 3, 'General', 'en', '0.333333333'], [1.5, 'General', 'hu', '1,5'], [1e12, '', 'en', '1E+12'],
  [123456789012, null, 'en', '1.23457E+11'], [-42, null, 'en', '-42'], ['2026-11-10', 'yyyy.mm.dd.', 'hu', '2026.11.10.'],
  [46336, 'yyyy-mm-dd', 'en', '2026-11-10'], ['2026-11-10', 'dd/mm/yyyy', 'en', '10/11/2026'], ['2026-11-10', 'mm/dd/yyyy', 'en', '11/10/2026'],
  ['2026-11-10T14:05', 'hh:mm', 'en', '14:05'], [0.5, 'hh:mm', 'en', '12:00'], ['2026-11-10', null, 'hu', '2026.11.10.'],
  ['2026-11-10', null, 'en', '2026-11-10'], ['2026-11-10T09:30', null, 'en', '2026-11-10 09:30'], ['abc', '0.00', 'en', 'abc'],
  [12, '@', 'en', '12'], ['2026-11-10', '@', 'en', '2026-11-10'], [-5, '0;(0)', 'en', '(5)'], [0, '0;-0;"zero"', 'en', 'zero'],
  [46336, 'yyyy-mm-dd hh:mm', 'en', '2026-11-10 00:00'], ['2026-11-10', 'd mmmm yyyy', 'en', '10 November 2026'],
  ['2026-11-10', 'yyyy. mmmm d.', 'hu', '2026. november 10.'], ['2026-11-10', '0', 'en', '46336'], [1234.5, '$#,##0.00', 'en', '$1,234.50'],
  [0.12345, '0.00%', 'en', '12.35%'], [1500000, '#,##0,', 'en', '1,500'], [7, '000', 'en', '007'], [0.5, '#.00', 'en', '.50'],
  [5, '"Total: "0', 'en', 'Total: 5'], [1234.5, '[$€-x] #,##0.00', 'en', '€ 1,234.50'], ['2026-11-10T14:05', 'h:mm AM/PM', 'en', '2:05 PM'],
], (c) => F.format(c[0], c[1], c[2]));

group('parseInput', [
  ['1234.5', 'en', { value: 1234.5 }], ['1,234.5', 'en', { value: 1234.5, num: '#,##0.00' }], ['1,234', 'en', { value: 1234, num: '#,##0' }],
  ['1 234,5', 'hu', { value: 1234.5, num: '#,##0.00' }], ['12,5', 'hu', { value: 12.5 }], ['12.5', 'hu', { value: 12.5 }],
  ['1.500', 'hu', { value: 1500, num: '#,##0' }], ['-7', 'en', { value: -7 }], ['12%', 'en', { value: 0.12, num: '0%' }],
  ['12,5%', 'hu', { value: 0.125, num: '0.0%' }], ['1 200 Ft', 'hu', { value: 1200, num: '#,##0 "Ft"' }],
  ['1200,50 Ft', 'hu', { value: 1200.5, num: '#,##0.00 "Ft"' }], ['€5', 'en', { value: 5, num: '#,##0.00 €' }],
  ['5 €', 'hu', { value: 5, num: '#,##0.00 €' }], ['$1,200.50', 'en', { value: 1200.5, num: '$#,##0.00' }],
  ['-$5', 'en', { value: -5, num: '$#,##0.00' }], ['2026-11-10', 'en', { value: '2026-11-10', num: 'yyyy-mm-dd' }],
  ['2026-11-10 14:30', 'en', { value: '2026-11-10T14:30', num: 'yyyy-mm-dd hh:mm' }],
  ['2026.11.10.', 'hu', { value: '2026-11-10', num: 'yyyy.mm.dd.' }], ['2026. 11. 10.', 'hu', { value: '2026-11-10', num: 'yyyy.mm.dd.' }],
  ['10/11/2026', 'hu', { value: '2026-11-10', num: 'dd/mm/yyyy' }], ['10/11/2026', 'en', { value: '2026-10-11', num: 'mm/dd/yyyy' }],
  ['2026-02-30', 'en', { value: '2026-02-30' }], ['14:30', 'en', { value: 0.6041666666666666, num: 'hh:mm' }],
  ['TRUE', 'en', { value: true }], ['hamis', 'hu', { value: false }], ['Igaz', 'en', { value: true }], ["'123", 'en', { value: '123' }],
  ['=szum(a1;1,5)', 'hu', { value: '=SUM(A1,1.5)' }], ['=SUM(A1,1.5)', 'en', { value: '=SUM(A1,1.5)' }], ['hello', 'en', { value: 'hello' }],
  ['', 'en', { value: '' }], ['  ', 'en', { value: '' }], ['1 200', 'en', { value: '1 200' }], ['06 30 123 4567', 'hu', { value: '06 30 123 4567' }],
  ['1.2.3', 'en', { value: '1.2.3' }], [' 42 ', 'en', { value: 42 }],
], (c) => F.parseInput(c[0], c[1]));

group('normalize', [
  ['=SZUM(A1;1,5)', 'hu', '=SUM(A1,1.5)'], ['=SUM(A1,1.5)', 'en', '=SUM(A1,1.5)'], ['=SUM(A1,1.5)', 'hu', '=SUM(A1,1.5)'],
  ['=HA(A1>0;"igen;nem";HAMIS)', 'hu', '=IF(A1>0,"igen;nem",FALSE)'],
  ["=FKERES(A1;'Lap 1'!A:B;2;HAMIS)", 'hu', "=VLOOKUP(A1,'Lap 1'!A:B,2,FALSE)"], ['=KEREK.FEL(A1*1,25;0)', 'hu', '=ROUNDUP(A1*1.25,0)'],
  ['=A1*1,5', 'hu', '=A1*1.5'], ['=HÉT.NAPJA(MA())', 'hu', '=WEEKDAY(TODAY())'], ['=ÖSSZEFŰZ("SZUM(";B1)', 'hu', '=CONCATENATE("SZUM(",B1)'],
  ['=sum(a1:b2)', 'en', '=SUM(A1:B2)'], ['plain', 'hu', 'plain'], ['=SZUM(1;2)+ÁTLAG(3;4)', 'hu', '=SUM(1,2)+AVERAGE(3,4)'],
  ['=HAHIBA(FKERES(A1;B:C;2;0);"")', 'hu', '=IFERROR(VLOOKUP(A1,B:C,2,0),"")'], ['=DARABHATÖBB(A:A;">10";B:B;"<>x")', 'hu', '=COUNTIFS(A:A,">10",B:B,"<>x")'],
  ['=SZÖVEG(A1;"0,00")', 'hu', '=TEXT(A1,"0,00")'], ['=XKERES(A1;B:B;C:C)', 'hu', '=XLOOKUP(A1,B:B,C:C)'], ['=HOL.VAN(5;A1:A9;0)', 'hu', '=MATCH(5,A1:A9,0)'],
  ['=Lap1!$a$1+1', 'hu', '=Lap1!$A$1+1'], ['=_xlfn.XLOOKUP(1,A:A,B:B)', 'en', '=XLOOKUP(1,A:A,B:B)'], ['=RÉSZLET(5%/12;60;-1000000)', 'hu', '=PMT(5%/12,60,-1000000)'],
], (c) => F.normalize(c[0], c[1]));

group('shiftRefs', [
  ['=A1+$B$2+C$3+$D4', 1, 1, '=B2+$B$2+D$3+$D5'], ['=SUM(A1:B2)', 2, 0, '=SUM(A3:B4)'], ['="A1"&A1', 1, 0, '="A1"&A2'],
  ["='My Sheet'!A1*Data!B$2", 1, 1, "='My Sheet'!B2*Data!C$2"], ['=A1', -1, 0, '=#REF!'], ['=SUM(A:A)', 0, 1, '=SUM(B:B)'],
  ['=SUM($A:A)', 5, 1, '=SUM($A:B)'], ['=SUM(1:1)', 1, 0, '=SUM(2:2)'], ['=SUM(A1)', 0, 0, '=SUM(A1)'], ['text', 1, 1, 'text'],
  ['=IF(A1>0, B1, "C1")', 1, 0, '=IF(A2>0, B2, "C1")'], ['=Z1', 0, 1, '=AA1'], ['=A1&"x', 1, 0, '=A1&"x'],
], (c) => F.shiftRefs(c[0], c[1], c[2]));

group('refs', [
  ["=A1+'My Sheet'!B2:C3+SUM($D$4)", [{ sheet: null, range: 'A1' }, { sheet: 'My Sheet', range: 'B2:C3' }, { sheet: null, range: 'D4' }]],
  ['=SUM(A:B)+"Z9"', [{ sheet: null, range: 'A:B' }]], ['42', []],
], (c) => F.refs(c[0]));

group('helpers', [
  ['colName 0', F.colName(0), 'A'], ['colName 25', F.colName(25), 'Z'], ['colName 26', F.colName(26), 'AA'], ['colName 701', F.colName(701), 'ZZ'],
  ['colIndex AB', F.colIndex('AB'), 27], ['colIndex $c', F.colIndex('$c'), 2], ['parseRange', F.parseRange('B2:A1'), { r1: 0, c1: 0, r2: 1, c2: 1 }],
  ['parseRange sheet', F.parseRange("'My Sheet'!$C$3"), { r1: 2, c1: 2, r2: 2, c2: 2, sheet: 'My Sheet' }],
  ['parseRange bad', F.parseRange('A1:'), null], ['rangeName', F.rangeName(0, 0, 1, 1), 'A1:B2'], ['rangeName obj', F.rangeName({ r1: 4, c1: 2, r2: 4, c2: 2 }), 'C5'],
  ['FUNCTIONS', ['SUM', 'XLOOKUP', 'NETWORKDAYS', 'IRR', 'TEXTJOIN'].every((n) => F.FUNCTIONS.indexOf(n) >= 0), true],
  ['toSerial', F.toSerial('2026-11-10'), 46336], ['fromSerial', F.fromSerial(46336.75), '2026-11-10T18:00'],
].map((c) => [c[0], c[1], c[2]]), (c) => c[1]);

// ---- performance: 20 000 formulas, half a 10 000-long dependency chain
const P = {};
const N = 10000;
for (let i = 1; i <= N; i++) { P['A' + i] = i; P['B' + i] = '=A' + i + '*2+1'; P['C' + i] = i === 1 ? '=B1' : '=B' + i + '+C' + (i - 1); }
const wp = F.workbook((s, k) => P[k], () => ['P'], () => ({ rows: N, cols: 3 }));
let t0 = Date.now();
let last;
for (let i = N; i >= 1; i--) { wp.value('P', 'B' + i); last = wp.value('P', 'C' + i); }
const cold = Date.now() - t0;
const top = wp.value('P', 'C' + N);
wp.invalidate();
t0 = Date.now();
for (let i = 1; i <= N; i++) { wp.value('P', 'B' + i); wp.value('P', 'C' + i); }
const warm = Date.now() - t0;
out.perf = { cold, warm, top, expect: N * N + 2 * N };
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node is not on PATH")
class SheetFormulaTests(unittest.TestCase):
    out = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(SCRIPT)
            r = subprocess.run([NODE, path, str(FORMULA)], capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            os.unlink(path)
        if r.returncode != 0:
            raise AssertionError(r.stderr or r.stdout)
        cls.out = json.loads(r.stdout)

    def check(self, name):
        g = self.out[name]
        self.assertGreater(g["n"], 0)
        self.assertEqual(g["fails"], [], "\n" + "\n".join("%s -> %s, want %s" % tuple(f) for f in g["fails"]))

    def test_node_check(self):
        r = subprocess.run([NODE, "--check", str(FORMULA)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_formulas(self):
        self.check("formulas")

    def test_workbook(self):
        self.check("workbook")

    def test_format(self):
        self.check("format")

    def test_parse_input(self):
        self.check("parseInput")

    def test_normalize(self):
        self.check("normalize")

    def test_shift_refs_and_refs(self):
        self.check("shiftRefs")
        self.check("refs")

    def test_helpers(self):
        self.check("helpers")

    def test_performance(self):
        p = self.out["perf"]
        self.assertEqual(p["top"], p["expect"])
        self.assertLess(p["cold"], 1000, p)
        self.assertLess(p["warm"], 1000, p)


if __name__ == "__main__":
    unittest.main()
