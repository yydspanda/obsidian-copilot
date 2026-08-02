import { OpencodeAbsentInstallActions } from "@/agentMode/backends/opencode/OpencodeInlineInstall";
import type CopilotPlugin from "@/main";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const install = jest.fn();
const setCustomBinaryPath = jest.fn();
const detectOpencodeCliPath = jest.fn();
const openInstallUI = jest.fn();

jest.mock("@/agentMode/backends/opencode/descriptor", () => ({
  getOpencodeBinaryManager: () => ({
    install: (...args: unknown[]) => install(...args),
    setCustomBinaryPath: (...args: unknown[]) => setCustomBinaryPath(...args),
  }),
  detectOpencodeCliPath: () => detectOpencodeCliPath(),
  OpencodeBackendDescriptor: { openInstallUI: (...args: unknown[]) => openInstallUI(...args) },
}));

const plugin = {} as CopilotPlugin;

/** A pending install whose progress/settlement the test drives by hand. */
function deferredInstall() {
  let resolve!: (value: { version: string; path: string }) => void;
  let reject!: (reason: unknown) => void;
  let onProgress: ((e: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  install.mockImplementation(
    (opts: { onProgress?: (e: unknown) => void; signal?: AbortSignal }) => {
      onProgress = opts.onProgress;
      signal = opts.signal;
      return new Promise<{ version: string; path: string }>((res, rej) => {
        resolve = res;
        reject = rej;
        // The manager rejects with an AbortError once the caller aborts.
        opts.signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          rej(err);
        });
      });
    }
  );
  return {
    resolve,
    get reject() {
      return reject;
    },
    get onProgress() {
      return onProgress;
    },
    get signal() {
      return signal;
    },
    settle: (value: { version: string; path: string }) => resolve(value),
    fail: (reason: unknown) => reject(reason),
  };
}

describe("OpencodeInlineInstall", () => {
  describe("OpencodeAbsentInstallActions()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      install.mockResolvedValue({ version: "1.2.3", path: "/bin/opencode" });
      setCustomBinaryPath.mockResolvedValue(undefined);
      detectOpencodeCliPath.mockResolvedValue("/usr/local/bin/opencode");
    });

    it("offers a download and an adopt-existing action while nothing is running", () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      expect(screen.getByRole("button", { name: "Download opencode" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "I already have it" })).not.toBeNull();
    });

    it("replaces the actions with live progress and a cancel control during a download", async () => {
      const pending = deferredInstall();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      await screen.findByRole("button", { name: "Cancel" });
      expect(screen.queryByRole("button", { name: "Download opencode" })).toBeNull();

      act(() => {
        pending.onProgress?.({
          phase: "download",
          received: 512,
          total: 1024,
          assetName: "opencode.zip",
        });
      });
      expect(screen.getByText("Downloading opencode.zip — 512 B / 1.0 KB (50%)")).not.toBeNull();
    });

    it("carries a first install through to completion and names the version it landed", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      await waitFor(() => expect(Notice).toHaveBeenCalledWith("opencode v1.2.3 installed."));
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) })
      );
      // A finished install leaves neither a download in flight nor a failure to
      // retry; the row itself goes away when the panel flips to ready.
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("aborts the install and returns to the idle actions when the user cancels", async () => {
      const pending = deferredInstall();
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(pending.signal?.aborted).toBe(true);
      await screen.findByRole("button", { name: "Download opencode" });
      // A cancellation is not a failure, so no error is surfaced.
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("surfaces the failure reason and offers a retry when the install pipeline throws", async () => {
      install.mockRejectedValue(new Error("GitHub API rate-limited"));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      expect(await screen.findByText("GitHub API rate-limited")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
    });

    it("runs a fresh install when the user retries after a failure", async () => {
      install.mockRejectedValueOnce(new Error("network down"));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));

      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

      await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByText("network down")).toBeNull());
    });

    it("adopts a detected binary by persisting it through the manager's validation", async () => {
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      await waitFor(() =>
        expect(setCustomBinaryPath).toHaveBeenCalledWith("/usr/local/bin/opencode")
      );
    });

    it("points the user at Configure when no opencode is found on the device", async () => {
      detectOpencodeCliPath.mockResolvedValue(null);
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      expect(await screen.findByText(/Couldn't find opencode on this device/)).not.toBeNull();
      expect(setCustomBinaryPath).not.toHaveBeenCalled();
    });

    it("opens the Configure dialog from the failure state so a custom path stays reachable", async () => {
      detectOpencodeCliPath.mockResolvedValue(null);
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      fireEvent.click(await screen.findByRole("button", { name: "Configure" }));
      expect(openInstallUI).toHaveBeenCalledWith(plugin);
    });

    it("blocks a download while a detect is in flight so the two can't both write the binary path", async () => {
      let finishDetect!: (path: string | null) => void;
      detectOpencodeCliPath.mockReturnValue(
        new Promise<string | null>((resolve) => {
          finishDetect = resolve;
        })
      );
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      const download = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Download opencode",
      });
      expect(download.disabled).toBe(true);
      fireEvent.click(download);
      expect(install).not.toHaveBeenCalled();

      await act(async () => {
        finishDetect(null);
      });
    });

    it.each([
      ["the detected path is no longer a file", "No file at /usr/local/bin/opencode"],
      [
        "the binary is not executable",
        "/usr/local/bin/opencode is not executable. chmod +x and try again.",
      ],
      [
        "the version probe reports nothing usable",
        "/usr/local/bin/opencode --version output didn't include a version number. Is this an opencode binary?",
      ],
    ])("reports the manager's reason when %s", async (_case, message) => {
      setCustomBinaryPath.mockRejectedValue(new Error(message));
      render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "I already have it" }));

      expect(await screen.findByText(message)).not.toBeNull();
    });

    it("aborts an in-flight install and stops updating state once unmounted", async () => {
      const pending = deferredInstall();
      const { unmount } = render(<OpencodeAbsentInstallActions plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Download opencode" }));
      await screen.findByRole("button", { name: "Cancel" });

      const emitProgress = pending.onProgress;
      unmount();

      expect(pending.signal?.aborted).toBe(true);
      // A late progress callback must not reach setState on an unmounted tree;
      // React would warn, and jest.setup promotes console noise into failures.
      expect(() =>
        emitProgress?.({ phase: "extract", message: "Extracting archive…" })
      ).not.toThrow();
    });
  });
});
