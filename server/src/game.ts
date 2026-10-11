import type { Action } from '@fa/shared';
import {
  advanceAuction as _advance, autoFill, endAuction, pauseAuction, placeBid, reopenAuction, resumeAuction, startAuction,
} from './services/auction';
import { nextRound, proceedToLeague, saveLineup, saveTactics, simulateRound, startLeague, newSeason } from './services/league';
import { kick, leaveRoom, setClub, setReady, transferHost, updateSettings } from './services/rooms';
import type { Ctx } from './services/types';

export const advanceAuction = _advance;

export interface DispatchResult { removed?: number[]; roomClosed?: boolean }

/** Single entry point for every validated client action. `pid` always comes from the authenticated session, never from the payload. */
export function dispatch(ctx: Ctx, roomId: string, pid: number, a: Action): DispatchResult {
  switch (a.type) {
    case 'lobby.setClub': setClub(ctx, roomId, pid, a.clubId); break;
    case 'lobby.ready': setReady(ctx, roomId, pid, a.ready); break;
    case 'lobby.settings': updateSettings(ctx, roomId, pid, a.settings); break;
    case 'lobby.kick': kick(ctx, roomId, pid, a.participantId); ctx.notify(roomId, 'snapshot'); return { removed: [a.participantId] };
    case 'lobby.transferHost': transferHost(ctx, roomId, pid, a.participantId); break;
    case 'lobby.leave': { const r = leaveRoom(ctx, roomId, pid); if (!r.roomClosed) ctx.notify(roomId, 'snapshot'); return { removed: [pid], roomClosed: r.roomClosed }; }
    case 'lobby.start': startAuction(ctx, roomId, pid); ctx.notify(roomId, 'snapshot'); break;
    case 'auction.bid': placeBid(ctx, roomId, pid, a.amount, a.nonce); break; // notifies itself
    case 'auction.pause': pauseAuction(ctx, roomId, pid); break;
    case 'auction.resume': resumeAuction(ctx, roomId, pid); break;
    case 'auction.end': endAuction(ctx, roomId, pid); break;
    case 'review.autofill': autoFill(ctx, roomId, pid); break;
    case 'review.reopen': reopenAuction(ctx, roomId, pid); break;
    case 'review.proceed': proceedToLeague(ctx, roomId, pid); break;
    case 'league.start': startLeague(ctx, roomId, pid); break;
    case 'league.simulate': simulateRound(ctx, roomId, pid); break;
    case 'league.next': nextRound(ctx, roomId, pid); break;
    case 'lineup.save': saveLineup(ctx, roomId, pid, a.lineup); break;
    case 'tactics.save': saveTactics(ctx, roomId, pid, a.tactics); break;
    case 'season.new': newSeason(ctx, roomId, pid, a.mode); break;
  }
  // Settings/club/ready/host changes do not notify inside the service layer.
  if (a.type === 'lobby.setClub' || a.type === 'lobby.ready' || a.type === 'lobby.settings' || a.type === 'lobby.transferHost') ctx.notify(roomId, 'snapshot');
  return {};
}
