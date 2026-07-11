import { ServiceType } from './enums';

/**
 * A single declared variable of a stack template. Surfaced to the user when
 * creating a service.
 */
export interface TemplateVariable {
  /** Human label, e.g. "Main JAR file" */
  name: string;
  /** Env var name injected into build/run, e.g. "MAIN_FILE" */
  envVariable: string;
  /** Default value */
  defaultValue: string;
  /** Help text shown in the UI */
  description?: string;
  /** Validation rules, e.g. "required|string" */
  rules?: string;
}

/**
 * Stack template. Describes how to build and run a given stack with an
 * isolated build step.
 */
export interface Template {
  id: string;
  name: string;
  description?: string;
  /** Free-form grouping label (e.g. 'Java', 'JavaScript'). */
  category?: string;
  type: ServiceType;
  baseImage: string;
  dockerfilePath?: string;
  installImage: string;
  installScript: string;
  defaultBuildCommand: string;
  defaultRunCommand: string;
  defaultPort: number;
  healthcheckPath?: string;
  variables: TemplateVariable[];
  isBuiltIn: boolean;
}
