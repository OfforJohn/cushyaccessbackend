export type SelectedMenuOptionRequest = {
  groupId: string;
  choiceIds: string[];
};

export type SelectedMenuOptionSnapshot = {
  groupId: string;
  groupName: string;
  choices: Array<{
    id: string;
    name: string;
    priceAdjustment: number;
  }>;
};

export type ResolvedMenuOptions = {
  selectedOptions: SelectedMenuOptionSnapshot[];
  optionPrice: number;
  configurationKey: string;
};
