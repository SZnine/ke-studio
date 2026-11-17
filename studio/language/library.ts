import { Profile } from './profile';
export interface Library {
  symbolAliases?: Profile['symbolAliases'];
  types: string[];
  typeMetadata?: Profile['typeMetadata'];
  values: Profile['values'];
  operators: Profile['operators'];
  compatibility: Profile['compatibility'];
  origins: Profile['origins'];
}
export function withLibrary(base: Profile, library: Library): Profile {
  const origins = { ...library.origins };
  for (const name of [...Object.keys(base.operators), ...Object.keys(base.values)])
    delete origins[name];
  return {
    ...base,
    symbolAliases: {
      concepts: { ...library.symbolAliases?.concepts, ...base.symbolAliases.concepts },
      operators: { ...library.symbolAliases?.operators, ...base.symbolAliases.operators }
    },
    builtInTypes: [...new Set([...base.builtInTypes, ...library.types])],
    typeMetadata: { ...library.typeMetadata, ...base.typeMetadata },
    values: { ...library.values, ...base.values },
    operators: { ...library.operators, ...base.operators },
    compatibility: { ...library.compatibility, ...base.compatibility },
    origins
  };
}
