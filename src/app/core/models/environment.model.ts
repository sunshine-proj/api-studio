import { PersistedEntity } from './common.model';

export interface EnvironmentVariable {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly enabled: boolean;
  /** Secret values are masked in the UI and redacted from history and exports. */
  readonly secret: boolean;
}

export interface Environment extends PersistedEntity {
  readonly name: string;
  readonly variables: readonly EnvironmentVariable[];
}
