// Base Step
export * from './step';

// Break-vs-continue semantics, per step. Relay-adapt runs every 7702 batch with
// `requireSuccess = false`, which CONTINUES past a failing call rather than
// breaking — so a failed step still mines and the trailing shield still runs.
// What each step leaves behind when that happens is documented and asserted
// here rather than in folklore.
export * from './failure-modes';

// Step exports
export * from './adapt';
export * from './token';
export * from './railgun';
export * from './swap';
export * from './borrow';
export * from './vault';
// Morpho Blue steps + market/risk math. This barrel line was missing, so every
// symbol in `steps/morpho` — the Blue steps, `MarketParams`, `getMarketId`,
// `WAD`, `ORACLE_PRICE_SCALE`, `borrowAssetsForShares` — was unreachable from
// the package root even though the recipes and `MorphoBlueAPI` that consume
// them were exported.
export * from './morpho';
