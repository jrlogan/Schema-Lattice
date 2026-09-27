/** Read-only probe of the public Log builder contract and lattice discovery. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const log = 'https://log.boating.systems';
const lattice = 'https://schemalattice.com';
const queries = [
  'a private written account of one day boating, with source evidence and uncertainty',
  'a vessel used for a boating outing, distinct from its owner and operator',
  'a recorded boat trip with a measured GPS track',
  'a marina berth assignment with a start and end time',
  'a maintenance service record for equipment aboard a vessel',
];

async function json(url) {
  const { stdout } = await execFileAsync('curl', [
    '--fail', '--silent', '--show-error', '--location', '--max-time', '15',
    '--header', 'Accept: application/json', url,
  ], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

const [capabilities, historySchema, service] = await Promise.all([
  json(`${log}/agent/capabilities.json`),
  json(`${log}/agent/history-schema.json`),
  json(lattice),
]);
const required = ['api', 'clientConfig', 'history'];
for (const key of required) {
  if (!capabilities[key]) throw new Error(`Log capabilities missing ${key}`);
}
if (capabilities.history.schema !== `${log}/agent/history-schema.json`) {
  throw new Error('Log capabilities and history schema URL disagree');
}
if (!historySchema || typeof historySchema !== 'object') {
  throw new Error('Log history schema is invalid');
}

const results = [];
for (const description of queries) {
  const url = new URL('/discover', lattice);
  url.searchParams.set('description', description);
  url.searchParams.set('limit', '3');
  url.searchParams.set('ephemeral', 'true');
  const discovery = await json(url);
  results.push({
    description,
    candidates: (discovery.results ?? []).map((item) => ({
      label: item.prefLabel,
      context: item.context?.title,
      similarity: item.similarity,
      uri: item.uri,
    })),
  });
}

const authority = service.authority;
const authorityAligned = authority === lattice;
const domainMatches = results.filter((item) => item.candidates.some((candidate) =>
  candidate.similarity >= 0.65 && /marine|boat|vessel|marina|log|trip/i.test(
    `${candidate.label} ${candidate.context}`,
  ),
)).length;
const report = {
  contract: {
    historyFormat: capabilities.history.format,
    historyVersion: capabilities.history.version,
    historyCallable: capabilities.history.callable,
    schemaAvailable: true,
    repositoryRequired: capabilities.repositoryRequired,
  },
  lattice: { authority, authorityAligned, domainMatches, queries: results },
};
console.log(JSON.stringify(report, null, 2));
if (!authorityAligned) process.exitCode = 1;
