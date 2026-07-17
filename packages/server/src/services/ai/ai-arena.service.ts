import { db } from '../../db';
import { aiArenaVotes } from '../../db/schema';
import { currentUser } from '../../lib/context';
import type { ArenaVoteInput } from '@zenith/shared';

/** 记录一次多模型对比投票 */
export async function recordArenaVote(input: ArenaVoteInput) {
  const user = currentUser();
  await db.insert(aiArenaVotes).values({
    userId: user.userId,
    question: input.question.slice(0, 8000),
    modelA: input.modelA,
    modelB: input.modelB,
    winner: input.winner,
  });
}
