export interface SelectiveStashActionState {
  enabled: boolean;
  label: string;
}

export function selectiveStashActionState(input: { selectedCount: number; busy: boolean; isDirty: boolean }): SelectiveStashActionState {
  const { selectedCount, busy, isDirty } = input;
  return {
    enabled: isDirty && selectedCount > 0 && !busy,
    label: selectedCount === 1 ? "Stash selected file" : `Stash ${selectedCount} selected files`
  };
}
