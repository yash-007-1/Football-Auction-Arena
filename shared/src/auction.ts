export interface AuctionConfig {
  budget: number;          // € millions per manager
  minSquad: number;        // minimum squad size required to finish
  maxSquad: number;        // hard cap (<= 25)
  timerSeconds: number;    // time a fresh lot is open
  bidResetSeconds: number; // timer is raised to at least this after any valid bid
  minPlayerPrice: number;  // € millions reserved per still-missing squad slot
}

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  budget: 1000, minSquad: 15, maxSquad: 25, timerSeconds: 20, bidResetSeconds: 10, minPlayerPrice: 1,
};
export const MAX_SQUAD_LIMIT = 25;
/** A legal starting XI needs one keeper plus ten outfield players. */
export const MIN_OUTFIELD = 10;
/** Keeper cap per squad: stops a squad being filled with keepers it can never play. */
export const MAX_GOALKEEPERS = 3;

export interface Bidder { teamId: number; budget: number; squadSize: number; connected: boolean; goalkeepers?: number }
export interface Lot { playerId: number; startPrice: number; currentBid: number | null; highBidderId: number | null }

export type BidError =
  | 'not_integer' | 'ineligible' | 'disconnected' | 'squad_full' | 'already_highest'
  | 'below_minimum' | 'over_budget' | 'paused' | 'no_lot' | 'gk_limit';

/** Minimum raise over the current bid, scaled with the price level. */
export function minIncrement(current: number): number {
  if (current < 20) return 1;
  if (current < 100) return 2;
  return 5;
}

/** Lowest bid currently accepted on a lot. */
export function minNextBid(lot: Lot): number {
  return lot.currentBid === null ? lot.startPrice : lot.currentBid + minIncrement(lot.currentBid);
}

/**
 * Highest bid a manager can place: their budget minus €minPlayerPrice for every additional player
 * they still need to reach the minimum squad (so nobody can spend themselves out of a legal squad).
 */
export function maxBidFor(b: Pick<Bidder, 'budget' | 'squadSize'>, cfg: AuctionConfig): number {
  const stillNeeded = Math.max(0, cfg.minSquad - b.squadSize - 1);
  return Math.max(0, b.budget - stillNeeded * cfg.minPlayerPrice);
}

export function validateBid(args: { lot: Lot | null; bidder: Bidder | undefined; amount: number; cfg: AuctionConfig; paused: boolean; lotIsGk?: boolean }): { ok: true } | { ok: false; error: BidError } {
  const { lot, bidder, amount, cfg, paused, lotIsGk } = args;
  if (!lot) return { ok: false, error: 'no_lot' };
  if (paused) return { ok: false, error: 'paused' };
  if (!bidder) return { ok: false, error: 'ineligible' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'not_integer' };
  if (!bidder.connected) return { ok: false, error: 'disconnected' };
  if (bidder.squadSize >= cfg.maxSquad) return { ok: false, error: 'squad_full' };
  if (lotIsGk && (bidder.goalkeepers ?? 0) >= MAX_GOALKEEPERS) return { ok: false, error: 'gk_limit' };
  if (lot.highBidderId === bidder.teamId) return { ok: false, error: 'already_highest' };
  if (amount < minNextBid(lot)) return { ok: false, error: 'below_minimum' };
  if (amount > maxBidFor(bidder, cfg)) return { ok: false, error: 'over_budget' };
  return { ok: true };
}

export const BID_ERROR_TEXT: Record<BidError, string> = {
  not_integer: 'Bids must be whole € millions.',
  ineligible: 'You are not part of this auction.',
  disconnected: 'You are disconnected.',
  squad_full: 'Your squad is full.',
  already_highest: 'You already have the highest bid.',
  below_minimum: 'Bid is below the minimum.',
  over_budget: 'Bid exceeds what you can afford (budget minus the reserve needed to fill your squad).',
  paused: 'The auction is paused.',
  no_lot: 'No player is currently being auctioned.',
  gk_limit: `A squad can hold at most ${MAX_GOALKEEPERS} goalkeepers.`,
};

export type SettleOutcome = { sold: true; teamId: number; price: number } | { sold: false };
export function settleLot(lot: Lot): SettleOutcome {
  if (lot.currentBid === null || lot.highBidderId === null) return { sold: false };
  return { sold: true, teamId: lot.highBidderId, price: lot.currentBid };
}

export interface SquadCheck { ok: boolean; problems: string[] }
export function checkSquad(positions: string[], cfg: AuctionConfig): SquadCheck {
  const problems: string[] = [];
  if (positions.length < cfg.minSquad) problems.push(`Needs ${cfg.minSquad - positions.length} more player(s) (minimum ${cfg.minSquad}).`);
  if (positions.length > cfg.maxSquad) problems.push(`Over the maximum of ${cfg.maxSquad}.`);
  const gks = positions.filter((x) => x === 'GK').length;
  if (gks === 0) problems.push('No goalkeeper.');
  if (gks > MAX_GOALKEEPERS) problems.push(`Too many goalkeepers (max ${MAX_GOALKEEPERS}).`);
  const outfield = positions.length - gks;
  if (outfield < MIN_OUTFIELD) problems.push(`Needs ${MIN_OUTFIELD - outfield} more outfield player(s) to field a starting XI.`);
  return { ok: problems.length === 0, problems };
}
