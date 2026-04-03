import { deleteThought } from "../delete";
import * as api from "../../lib/api";
import * as readline from "readline";

jest.mock("../../lib/api");
jest.mock("readline");

const mockCallTool = api.callTool as jest.MockedFunction<typeof api.callTool>;
const mockCreateInterface = readline.createInterface as jest.MockedFunction<
  typeof readline.createInterface
>;

/**
 * Helper that sets up a readline mock that answers the confirmation prompt
 * with the given answer string.
 */
function mockReadline(answer: string): void {
  mockCreateInterface.mockReturnValue({
    question: (_prompt: string, callback: (answer: string) => void) => {
      callback(answer);
    },
    close: jest.fn(),
  } as unknown as readline.Interface);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCallTool.mockResolvedValue("Deleted thought thought-abc");
});

describe("deleteThought", () => {
  describe("with --yes flag", () => {
    it("skips confirmation and calls delete_thought", async () => {
      await deleteThought("thought-abc", { yes: true });

      expect(mockCreateInterface).not.toHaveBeenCalled();
      expect(mockCallTool).toHaveBeenCalledWith("delete_thought", { id: "thought-abc" });
    });

    it("includes scope when provided", async () => {
      await deleteThought("thought-abc", { yes: true, scope: "shared" });

      expect(mockCallTool).toHaveBeenCalledWith("delete_thought", {
        id: "thought-abc",
        scope: "shared",
      });
    });

    it("does not include scope when not provided", async () => {
      await deleteThought("thought-abc", { yes: true });

      const callArgs = mockCallTool.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty("scope");
    });

    it("prints the result to stdout", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await deleteThought("thought-abc", { yes: true });

      expect(consoleSpy).toHaveBeenCalledWith("Deleted thought thought-abc");
      consoleSpy.mockRestore();
    });
  });

  describe("without --yes flag (interactive confirmation)", () => {
    it("calls delete_thought when user answers 'y'", async () => {
      mockReadline("y");

      await deleteThought("thought-abc", {});

      expect(mockCallTool).toHaveBeenCalledWith("delete_thought", { id: "thought-abc" });
    });

    it("calls delete_thought when user answers 'yes'", async () => {
      mockReadline("yes");

      await deleteThought("thought-abc", {});

      expect(mockCallTool).toHaveBeenCalledWith("delete_thought", { id: "thought-abc" });
    });

    it("aborts without calling callTool when user answers 'n'", async () => {
      mockReadline("n");
      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await deleteThought("thought-abc", {});

      expect(mockCallTool).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("Aborted.");
      consoleSpy.mockRestore();
    });

    it("aborts when user gives empty answer", async () => {
      mockReadline("");

      await deleteThought("thought-abc", {});

      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("prints error message when callTool throws", async () => {
      mockCallTool.mockRejectedValue(new Error("not found"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await deleteThought("thought-abc", { yes: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
