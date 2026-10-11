import { describe, expect, it } from 'vitest';
import { DEFAULT_AUCTION_CONFIG as cfg, maxBidFor, minIncrement, minNextBid, settleLot, validateBid, checkSquad } from '../src';
import type { Bidder, Lot } from '../src';

const lot = (over: Partial<Lot> = {}): Lot => ({ playerId: 1, startPrice: 10, currentBid: null, highBidderId: null, ...over });
const bidder = (over: Partial<Bidder> = {}): Bidder => ({ teamId: 1, budget: 1000, squadSize: 0, connected: true, ...over });

describe('auction rules', () => {
  it('rejects a fourth goalkeeper but still allows outfield bids at that point', () => {
    const v = (isGk: boolean) => validateBid({ lot: lot(), bidder: bidder({ goalkeepers: 3 }), amount: 10, cfg, paused: false, lotIsGk: isGk });
    expect(v(true)).toEqual({ ok: false, error: 'gk_limit' });
    expect(v(false)).toEqual({ ok: true });
  });

  it('first bid must reach the starting price, later bids need an increment', () => {
    expect(minNextBid(lot())).toBe(10);
    expect(minNextBid(lot({ currentBid: 10, highBidderId: 2 }))).toBe(11);
    expect(minNextBid(lot({ currentBid: 50, highBidderId: 2 }))).toBe(52);
    expect(minNextBid(lot({ currentBid: 120, highBidderId: 2 }))).toBe(125);
    expect(minIncrement(19)).toBe(1);
  });

  it('accepts a valid bid and rejects each invalid kind', () => {
    const v = (amount: number, b = bidder(), l: Lot | null = lot(), paused = false) => validateBid({ lot: l, bidder: b, amount, cfg, paused });
    expect(v(10)).toEqual({ ok: true });
    expect(v(9)).toEqual({ ok: false, error: 'below_minimum' });
    expect(v(10.5)).toEqual({ ok: false, error: 'not_integer' });
    expect(v(-5)).toEqual({ ok: false, error: 'not_integer' });
    expect(v(10, bidder({ connected: false }))).toEqual({ ok: false, error: 'disconnected' });
    expect(v(10, bidder({ squadSize: cfg.maxSquad }))).toEqual({ ok: false, error: 'squad_full' });
    expect(validateBid({ lot: lot(), bidder: undefined, amount: 10, cfg, paused: false })).toEqual({ ok: false, error: 'ineligible' });
    expect(v(10, bidder(), null)).toEqual({ ok: false, error: 'no_lot' });
    expect(v(10, bidder(), lot(), true)).toEqual({ ok: false, error: 'paused' });
    expect(v(12, bidder(), lot({ currentBid: 11, highBidderId: 1 }))).toEqual({ ok: false, error: 'already_highest' });
  });

  it('prevents bids above the budget, keeping a reserve to fill the minimum squad', () => {
    expect(maxBidFor({ budget: 1000, squadSize: 0 }, cfg)).toBe(1000 - 14);
    expect(maxBidFor({ budget: 100, squadSize: 14 }, cfg)).toBe(100);
    expect(maxBidFor({ budget: 20, squadSize: 3 }, cfg)).toBe(20 - 11);
    const r = validateBid({ lot: lot(), bidder: bidder({ budget: 50, squadSize: 0 }), amount: 40, cfg, paused: false });
    expect(r).toEqual({ ok: false, error: 'over_budget' });
    const ok = validateBid({ lot: lot(), bidder: bidder({ budget: 50, squadSize: 0 }), amount: 36, cfg, paused: false });
    expect(ok).toEqual({ ok: true });
  });

  it('settles sold and unsold lots', () => {
    expect(settleLot(lot({ currentBid: 30, highBidderId: 4 }))).toEqual({ sold: true, teamId: 4, price: 30 });
    expect(settleLot(lot())).toEqual({ sold: false });
  });

  it('checks squad completeness', () => {
    expect(checkSquad(['GK', 'CB'], cfg).ok).toBe(false);
    expect(checkSquad([...Array(14).fill('CB'), 'GK'], cfg).ok).toBe(true);
    // 15 players but only 9 outfielders cannot field an XI
    expect(checkSquad([...Array(9).fill('CB'), ...Array(6).fill('GK')], cfg).ok).toBe(false);
    expect(checkSquad([...Array(10).fill('CB'), 'GK', 'GK', 'GK', 'GK'], cfg).problems.join(' ')).toMatch(/too many goalkeepers/i);
    expect(checkSquad([...Array(10).fill('CB'), 'GK'], { ...cfg, minSquad: 11 }).ok).toBe(true);
    expect(checkSquad(Array(15).fill('CB'), cfg).problems.join(' ')).toMatch(/goalkeeper/i);
  });
});
