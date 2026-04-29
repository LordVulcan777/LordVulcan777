const crypto = require('crypto');

class KPITracker {
  constructor() {
    this.global = {
      scenarios: 0,
      complete: 0,
      exception: 0,
      terminal: 0,
      rejected: 0,
      totalCycleMs: 0,
      exceptions: 0,
      humanTouches: 0,
      blockchainProofs: 0,
      loopCounts: { A: 0, B: 0, C: 0, D: 0, T: 0 },
    };
  }

  startScenario(name) {
    return {
      name,
      startedAt: Date.now(),
      exceptions: 0,
      humanTouches: 0,
      blockchainProofs: 0,
      loopsFired: [],
      status: 'IN_PROGRESS',
    };
  }

  endScenario(s) {
    s.cycleMs = Date.now() - s.startedAt;
    this.global.scenarios += 1;
    this.global.totalCycleMs += s.cycleMs;
    this.global.exceptions += s.exceptions;
    this.global.humanTouches += s.humanTouches;
    this.global.blockchainProofs += s.blockchainProofs;
    if (s.status === 'COMPLETE') this.global.complete += 1;
    if (s.status === 'EXCEPTION') this.global.exception += 1;
    if (s.status === 'TERMINAL') this.global.terminal += 1;
    if (s.status === 'REJECTED') this.global.rejected += 1;
    for (const l of s.loopsFired) this.global.loopCounts[l] += 1;
    return s;
  }
}

class ArchitectureSimulator {
  constructor() {
    this.kpi = new KPITracker();
    this.trustedActors = new Set(['supplier-alpha', 'manufacturer-1', 'logistics-7', 'retailer-9']);
    this.seenPOs = new Set();
    this.retryLimit = 2;
  }

  log(component, message) {
    console.log(`[${component}] ${message}`);
  }

  fireLoop(s, loop, why) {
    s.loopsFired.push(loop);
    this.log(`Loop ${loop}`, why);
  }

  eventEntryGate(input, s) {
    this.log('Event Entry Gate', `Authenticating actor '${input.actor}' and validating payload...`);
    if (!this.trustedActors.has(input.actor)) {
      this.log('Event Entry Gate', 'REJECT: unauthorized actor not present in trusted registry.');
      s.status = 'REJECTED';
      return null;
    }
    const required = ['poId', 'actor', 'amountEUR', 'poQty', 'grQty', 'invoiceAmount', 'currency'];
    const missing = required.filter((f) => input[f] === undefined || input[f] === null);
    if (missing.length) {
      this.log('Event Entry Gate', `REJECT: corrupt data missing required fields: ${missing.join(', ')}.`);
      s.status = 'REJECTED';
      return null;
    }
    if (this.seenPOs.has(input.poId)) {
      this.log('Event Entry Gate', `REJECT: duplicate PO '${input.poId}' already processed.`);
      s.status = 'REJECTED';
      return null;
    }
    this.seenPOs.add(input.poId);
    this.log('Event Entry Gate', 'Authenticated, source validated, and event normalized.');
    return { ...input, normalizedAt: new Date().toISOString(), caseState: 'INTAKE' };
  }

  lcncWorkflowEngine(e, s) {
    this.log('LCNC Workflow Engine', `Case created for PO ${e.poId}; deciding route (RPA vs human review).`);
    const needsRPA = !e.manualOnly;
    if (!needsRPA) {
      this.log('LCNC Workflow Engine', 'Manual-only route selected; sending to Exception Handler for human workflow.');
      this.fireLoop(s, 'A', 'Loop A: escalation to exception handling with updated case state (manual pathway).');
      return { route: 'EXCEPTION' };
    }
    this.log('LCNC Workflow Engine', 'RPA route selected; dispatching automation payload.');
    return { route: 'RPA' };
  }

  rpaExecutionBot(e) {
    this.log('RPA Execution Bot', 'Extracting PO/GR/Invoice data and reconciling across ERP/WMS/SCM connectors.');
    return {
      po: { id: e.poId, qty: e.poQty, amount: e.amountEUR, regulatory: !!e.complianceAuditFlag },
      gr: { qty: e.grQty },
      invoice: { amount: e.invoiceAmount },
    };
  }

  rpaValidationBot(bundle, e, s) {
    this.log('RPA Validation Bot', 'Running rule checks + 3-way match (PO vs Goods Receipt vs Invoice).');
    const exceptions = [];
    if (bundle.po.qty !== bundle.gr.qty) exceptions.push('QTY_MISMATCH');
    if (bundle.po.amount !== bundle.invoice.amount) exceptions.push('INVOICE_MISMATCH');
    if (e.forceValidationError) exceptions.push('RULESET_VIOLATION');
    if (exceptions.length) {
      s.exceptions += exceptions.length;
      this.log('RPA Validation Bot', `Exceptions flagged: ${exceptions.join(', ')}.`);
      this.fireLoop(s, 'A', 'Loop A: validation exceptions escalated to Exception Handler with updated exception state.');
      return { valid: false, exceptions };
    }
    this.log('RPA Validation Bot', 'Validation passed; consistency confirmed.');
    return { valid: true, exceptions: [] };
  }

  exceptionHandler(e, validation, s) {
    this.log('Exception Handler', 'Assessing exception case; entering human-in-the-loop resolution.');
    let retries = 0;
    while (retries < this.retryLimit) {
      retries += 1;
      s.humanTouches += 1;
      this.log('Exception Handler', `Human review #${retries} for PO ${e.poId}.`);
      if (e.unresolvable) continue;
      if (validation.exceptions.includes('QTY_MISMATCH') && e.partialDelivery) {
        this.log('Exception Handler', 'Partial delivery approved; updating case for split settlement and re-entry.');
      } else {
        this.log('Exception Handler', 'Exception resolved manually; case returned with updated exception state.');
      }
      return { resolved: true, retries };
    }
    this.log('Exception Handler', 'Retry limit exceeded; terminal case status reached.');
    s.status = 'TERMINAL';
    return { resolved: false, retries };
  }

  needsBlockchainProof(e) {
    return e.amountEUR > 50000 || e.complianceAuditFlag;
  }

  blockchainTrustEnforcer(e, s) {
    this.log('Blockchain Trust Enforcer', 'Policy check: evaluating selective proof requirement.');
    if (!this.needsBlockchainProof(e)) {
      const loop = e.directFromEntry ? 'C' : 'B';
      this.fireLoop(s, loop, `Loop ${loop}: no proof required, direct to downstream actions.`);
      return { proofRequired: false };
    }

    this.log('Blockchain Trust Enforcer', 'Proof required; simulating ledger write + smart contract verification.');
    if (e.smartContractTimeout) {
      this.fireLoop(s, 'T', 'Loop T: smart contract timeout triggered exception handling.');
      return { proofRequired: true, timeout: true };
    }

    const hash = crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex');
    s.blockchainProofs += 1;
    this.log('Blockchain Trust Enforcer', `Hash generated: ${hash.slice(0, 20)}...`);
    return { proofRequired: true, timeout: false, hash };
  }

  offChainTraceabilityStore(e, proof) {
    const record = {
      epcisEventType: 'ObjectEvent',
      cbvBizStep: 'receiving',
      poId: e.poId,
      hashReference: proof.hash || null,
      payloadStored: true,
    };
    this.log('Off-Chain Traceability Store', `Operation record stored in EPCIS/CBV structure for PO ${e.poId}.`);
    if (record.hashReference) this.log('Off-Chain Traceability Store', 'Hash linkage established to on-chain proof.');
    return record;
  }

  downstreamActions(e, s) {
    const paymentMode = e.partialDelivery ? 'split payment release' : 'payment release';
    this.log('Downstream Actions', `${paymentMode}, SLA enforcement, and compliance logging executed.`);
    if (!s.status || s.status === 'IN_PROGRESS') s.status = 'COMPLETE';
  }

  monitoring(s) {
    this.log('Monitoring & KPI Tracker', `Cycle time=${s.cycleMs || 'pending'}ms, exceptions=${s.exceptions}, humanTouches=${s.humanTouches}, proofs=${s.blockchainProofs}.`);
    this.fireLoop(s, 'D', 'Loop D: monitoring feedback sent to LCNC orchestration layer for tuning.');
  }

  runScenario(input) {
    console.log('\n============================================================');
    console.log(`SCENARIO: ${input.name}`);
    console.log('============================================================');

    const s = this.kpi.startScenario(input.name);
    const event = this.eventEntryGate(input, s);
    if (!event) {
      this.monitoring(s);
      const result = this.kpi.endScenario(s);
      this.printScenarioSummary(result);
      return result;
    }

    let route = this.lcncWorkflowEngine(event, s);
    if (route.route === 'EXCEPTION') {
      const exResult = this.exceptionHandler(event, { exceptions: ['MANUAL_REVIEW'] }, s);
      if (!exResult.resolved) {
        this.monitoring(s);
        const result = this.kpi.endScenario(s);
        this.printScenarioSummary(result);
        return result;
      }
    }

    if (input.directFromEntry) {
      this.log('LCNC Workflow Engine', 'Direct rerouting from entry/workflow check to trust decision node.');
    }

    const execution = this.rpaExecutionBot(event);
    const validation = this.rpaValidationBot(execution, event, s);

    if (!validation.valid) {
      const exResult = this.exceptionHandler(event, validation, s);
      if (!exResult.resolved) {
        this.monitoring(s);
        const result = this.kpi.endScenario(s);
        this.printScenarioSummary(result);
        return result;
      }
    }

    const proof = this.blockchainTrustEnforcer(event, s);
    if (proof.timeout) {
      const exResult = this.exceptionHandler(event, { exceptions: ['SMART_CONTRACT_TIMEOUT'] }, s);
      if (!exResult.resolved) {
        this.monitoring(s);
        const result = this.kpi.endScenario(s);
        this.printScenarioSummary(result);
        return result;
      }
      const retryProof = this.blockchainTrustEnforcer({ ...event, smartContractTimeout: false }, s);
      if (retryProof.hash) this.offChainTraceabilityStore(event, retryProof);
    } else {
      this.offChainTraceabilityStore(event, proof);
    }

    this.downstreamActions(event, s);
    this.monitoring(s);
    const result = this.kpi.endScenario(s);
    this.printScenarioSummary(result);
    return result;
  }

  printScenarioSummary(s) {
    console.log('--- Scenario KPI Summary ---');
    console.log(`Final status: ${s.status}`);
    console.log(`Loops fired: ${s.loopsFired.join(', ') || 'None'}`);
    console.log(`Cycle time: ${s.cycleMs} ms`);
    console.log(`Exception count: ${s.exceptions}`);
    console.log(`Human touch count: ${s.humanTouches}`);
    console.log(`Blockchain proof count: ${s.blockchainProofs}`);
  }

  printGlobalDashboard() {
    const g = this.kpi.global;
    const avg = g.scenarios ? (g.totalCycleMs / g.scenarios).toFixed(2) : 0;
    const exceptionRate = g.scenarios ? ((g.exceptions / g.scenarios) * 100).toFixed(2) : 0;
    console.log('\n################ CONSOLIDATED KPI DASHBOARD ################');
    console.log(`Scenarios run: ${g.scenarios}`);
    console.log(`Status totals -> COMPLETE: ${g.complete}, EXCEPTION: ${g.exception}, TERMINAL: ${g.terminal}, REJECTED: ${g.rejected}`);
    console.log(`Average cycle time: ${avg} ms`);
    console.log(`Total exceptions: ${g.exceptions} (rate: ${exceptionRate}%)`);
    console.log(`Total human touches: ${g.humanTouches}`);
    console.log(`Total blockchain proofs: ${g.blockchainProofs}`);
    console.log(`Loop counts: A=${g.loopCounts.A}, B=${g.loopCounts.B}, C=${g.loopCounts.C}, D=${g.loopCounts.D}, T=${g.loopCounts.T}`);
    console.log('############################################################');
  }
}

const scenarios = [
  { name: 'Happy path: clean PO, no exceptions', poId: 'PO-1001', actor: 'supplier-alpha', amountEUR: 12000, poQty: 100, grQty: 100, invoiceAmount: 12000, currency: 'EUR' },
  { name: 'Quantity mismatch: GR differs from PO, human resolves', poId: 'PO-1002', actor: 'supplier-alpha', amountEUR: 15000, poQty: 100, grQty: 95, invoiceAmount: 15000, currency: 'EUR' },
  { name: 'Invoice amount mismatch: invoice does not match PO value', poId: 'PO-1003', actor: 'manufacturer-1', amountEUR: 18000, poQty: 50, grQty: 50, invoiceAmount: 17900, currency: 'EUR' },
  { name: 'High-value PO: mandatory blockchain proof > €50k', poId: 'PO-1004', actor: 'supplier-alpha', amountEUR: 70000, poQty: 10, grQty: 10, invoiceAmount: 70000, currency: 'EUR' },
  { name: 'Duplicate PO: same PO submitted twice, rejected at entry', poId: 'PO-1001', actor: 'supplier-alpha', amountEUR: 12000, poQty: 100, grQty: 100, invoiceAmount: 12000, currency: 'EUR' },
  { name: 'Corrupt data: missing required fields, rejected at entry', poId: 'PO-1005', actor: 'supplier-alpha', amountEUR: 5000, poQty: 10, grQty: 10, currency: 'EUR' },
  { name: 'Unauthorized actor: supplier not in trusted registry', poId: 'PO-1006', actor: 'unknown-supplier', amountEUR: 6000, poQty: 20, grQty: 20, invoiceAmount: 6000, currency: 'EUR' },
  { name: 'Smart contract timeout: blockchain tx fails, Loop T fires', poId: 'PO-1007', actor: 'manufacturer-1', amountEUR: 90000, poQty: 4, grQty: 4, invoiceAmount: 90000, currency: 'EUR', smartContractTimeout: true },
  { name: 'Retry limit exceeded: exception unresolvable, terminal status', poId: 'PO-1008', actor: 'supplier-alpha', amountEUR: 20000, poQty: 30, grQty: 20, invoiceAmount: 20000, currency: 'EUR', unresolvable: true },
  { name: 'Partial delivery: split payment, partial GR match', poId: 'PO-1009', actor: 'logistics-7', amountEUR: 24000, poQty: 100, grQty: 60, invoiceAmount: 24000, currency: 'EUR', partialDelivery: true },
  { name: 'Compliance audit flag: mandatory on-chain proof', poId: 'PO-1010', actor: 'retailer-9', amountEUR: 8000, poQty: 12, grQty: 12, invoiceAmount: 8000, currency: 'EUR', complianceAuditFlag: true },
  { name: 'Edge case: direct rerouting path from entry check (Loop C)', poId: 'PO-1011', actor: 'supplier-alpha', amountEUR: 3000, poQty: 5, grQty: 5, invoiceAmount: 3000, currency: 'EUR', directFromEntry: true },
  { name: 'Edge case: manual-only workflow route then success', poId: 'PO-1012', actor: 'manufacturer-1', amountEUR: 11000, poQty: 40, grQty: 40, invoiceAmount: 11000, currency: 'EUR', manualOnly: true },
];

console.log('Hyperautomation Architecture Simulation - Section 1 Reference Model');
console.log('Components: Entry Gate, LCNC, RPA bots, Exception handling, Blockchain trust, Off-chain store, Downstream, Monitoring.');

const sim = new ArchitectureSimulator();
for (const scenario of scenarios) sim.runScenario(scenario);
sim.printGlobalDashboard();
