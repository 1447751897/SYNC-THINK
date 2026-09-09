import { createContext } from 'react';

export const GeneratedImageModelsContext = createContext<ReadonlyMap<string, string>>(new Map());
