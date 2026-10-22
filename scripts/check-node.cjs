'use strict';
const floors = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const floor = floors[major];
if (!floor || minor < floor[0] || (minor === floor[0] && patch < floor[1])) {
  console.error('Node ' + process.versions.node + ' is outside the supported patched runtime policy. Use Node 22.23.4+, 24.22.1+, or 26.12.1+ within those release lines.');
  process.exit(1);
}
console.log('Patched Node runtime: ' + process.versions.node);
