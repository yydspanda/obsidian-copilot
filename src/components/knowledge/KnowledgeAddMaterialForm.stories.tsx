import type { Meta, StoryObj } from "@/lib/story";
import {
  KnowledgeAddMaterialForm,
  type KnowledgeAddMaterialFormProps,
} from "./KnowledgeAddMaterialForm";

type Props = KnowledgeAddMaterialFormProps;
const noop = () => {};
const session: Props["session"] = {
  bundleId: "research",
  sourceRoot: "Knowledge/Sources",
  choices: [
    { path: "Knowledge/Sources/Interview observations.md", size: 2417 },
    {
      path: "Reading/2026/Independent studies/Longitudinal study with detailed supplementary evidence.pdf",
      size: 34820,
    },
    { path: "Reading/Field notes.txt", size: 670 },
  ],
};
const selection: NonNullable<Props["selection"]> = {
  bundleId: session.bundleId,
  sourcePath: session.choices[0].path,
  destinationPath: session.choices[0].path,
  mode: "register",
};
const snapshot: NonNullable<Props["selection"]> = {
  bundleId: session.bundleId,
  sourcePath: session.choices[1].path,
  destinationPath:
    "Knowledge/Sources/Vault/Reading/2026/Independent studies/Longitudinal study with detailed supplementary evidence.pdf",
  mode: "snapshot",
};

const meta = {
  title: "Knowledge/Add material form",
  component: KnowledgeAddMaterialForm,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    session,
    selection: null,
    queueState: "paused",
    query: "",
    snapshotConfirmed: false,
    busy: false,
    error: null,
    onQueryChange: noop,
    onSelect: noop,
    onSnapshotConfirmChange: noop,
    onAdd: noop,
    onCancel: noop,
  },
} satisfies Meta<Props>;
export default meta;

export const ChooseMaterial: StoryObj<Props> = { args: {} };
export const SearchResults: StoryObj<Props> = { args: { query: "Reading" } };
export const NoMatches: StoryObj<Props> = { args: { query: "not found" } };
export const RegisterPaused: StoryObj<Props> = { args: { selection } };
export const SnapshotNeedsConsent: StoryObj<Props> = { args: { selection: snapshot } };
export const SnapshotReadyRunning: StoryObj<Props> = {
  args: { selection: snapshot, snapshotConfirmed: true, queueState: "running" },
};
export const Adding: StoryObj<Props> = { args: { selection, busy: true } };
export const QueueUnknown: StoryObj<Props> = { args: { selection, queueState: "unknown" } };
export const Conflict: StoryObj<Props> = {
  args: {
    selection: snapshot,
    error: "The destination is already occupied. No file was overwritten.",
  },
};
