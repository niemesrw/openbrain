import { getVector, deleteVector } from "../services/vectors";
import type { DeleteThoughtArgs, UserContext } from "../types";

export async function handleDeleteThought(
  args: DeleteThoughtArgs,
  user: UserContext
): Promise<string> {
  const { id, scope = "private" } = args;

  const indexName =
    scope === "shared" ? "shared" : `private-${user.userId}`;

  // Fetch existing vector to verify ownership
  const existing = await getVector(indexName, id);
  if (!existing) {
    return `Error: thought not found (id: ${id})`;
  }
  if (existing.metadata.user_id !== user.userId) {
    return "Error: you do not have permission to delete this thought";
  }

  await deleteVector(indexName, id);

  return `Deleted thought ${id}`;
}
