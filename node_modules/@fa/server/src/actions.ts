import { z } from 'zod';
import type { Action } from '@fa/shared';
import { FORMATION_IDS, type FormationId } from '@fa/shared';
import { lineupSchema, tacticsSchema } from './services/league';
import { settingsSchema } from './services/rooms';

const id = z.number().int().positive();

/** Every client action is parsed here before it can touch the game. Unknown fields and types are rejected. */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lobby.setClub'), clubId: id.nullable() }).strict(),
  z.object({ type: z.literal('lobby.ready'), ready: z.boolean() }).strict(),
  z.object({ type: z.literal('lobby.settings'), settings: settingsSchema }).strict(),
  z.object({ type: z.literal('lobby.kick'), participantId: id }).strict(),
  z.object({ type: z.literal('lobby.transferHost'), participantId: id }).strict(),
  z.object({ type: z.literal('lobby.leave') }).strict(),
  z.object({ type: z.literal('lobby.start') }).strict(),
  z.object({ type: z.literal('auction.bid'), amount: z.number().int().min(1).max(100000), nonce: z.string().min(4).max(64) }).strict(),
  z.object({ type: z.literal('auction.pause') }).strict(),
  z.object({ type: z.literal('auction.resume') }).strict(),
  z.object({ type: z.literal('auction.end') }).strict(),
  z.object({ type: z.literal('review.autofill') }).strict(),
  z.object({ type: z.literal('review.reopen') }).strict(),
  z.object({ type: z.literal('review.proceed') }).strict(),
  z.object({ type: z.literal('league.start') }).strict(),
  z.object({ type: z.literal('league.simulate') }).strict(),
  z.object({ type: z.literal('league.next') }).strict(),
  z.object({ type: z.literal('lineup.save'), lineup: lineupSchema }).strict(),
  z.object({ type: z.literal('tactics.save'), tactics: tacticsSchema }).strict(),
  z.object({ type: z.literal('season.new'), mode: z.enum(['keep', 'reset']) }).strict(),
]);

export function parseAction(raw: unknown): Action {
  return actionSchema.parse(raw) as unknown as Action;
}
export type { FormationId };
export { FORMATION_IDS };
