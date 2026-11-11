const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const match = app.match(/function calendarDayDifference\(d, birthday\) \{[\s\S]*?\n\}/);
assert.ok(match, 'calendarDayDifference exists in app.js');
const calendarDayDifference = vm.runInNewContext(`(${match[0]})`);

const birthday = new Date(2025, 2, 8, 12);
const afterDstStart = new Date(2025, 2, 10, 12);
assert.equal(afterDstStart - birthday, 47 * 60 * 60 * 1000, 'test spans the spring DST transition');
assert.equal(calendarDayDifference(afterDstStart, birthday), 2);
console.log('DST calendar-day calculation: 1 test passed');
