import { VertexAI } from '@google-cloud/vertexai';
import { getEnv } from '@project-signal/config';

let _vertexAi: VertexAI;

export function getVertexAI(): VertexAI {
  if (!_vertexAi) {
    const env = getEnv();
    _vertexAi = new VertexAI({
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.VERTEX_AI_LOCATION,
    });
  }
  return _vertexAi;
}

export function getScorerModel(): string {
  return getEnv().SCORER_MODEL;
}

export function getReporterModel(): string {
  return getEnv().REPORTER_MODEL;
}
