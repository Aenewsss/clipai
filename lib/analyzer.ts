import { TranscriptSegment, ClipSuggestion } from '@/types';
import { LLMProvider } from '@/lib/providers/llm/types';

interface AnalyzeOptions {
  minDuration?: number;
  maxDuration?: number;
  style?: 'viral' | 'educational' | 'funny' | 'dramatic';
}

export async function analyzeTranscript(
  segments: TranscriptSegment[],
  videoTitle: string,
  options: AnalyzeOptions = {},
  llm: LLMProvider
): Promise<ClipSuggestion[]> {
  const {
    minDuration = 60,
    maxDuration = 90,
    style = 'viral',
  } = options;

  const transcriptText = segments
    .map(s => `[${formatTimestamp(s.start)} - ${formatTimestamp(s.end)}] ${s.text}`)
    .join('\n');

  const styleGuides: Record<string, string> = {
    viral: 'Busque momentos com ganchos fortes, opiniões polêmicas, revelações surpreendentes, ou frases de impacto que geram compartilhamento.',
    educational: 'Busque explicações claras de conceitos, dicas práticas, ou insights valiosos que ensinam algo útil ao espectador.',
    funny: 'Busque momentos engraçados, piadas, situações cômicas, reações inesperadas, ou interações divertidas.',
    dramatic: 'Busque momentos de tensão, emoção forte, viradas narrativas, confrontos, ou revelações impactantes.',
  };

  const prompt = `Você é um editor de vídeo especialista em criar clips virais para TikTok e Reels.

Analise a transcrição abaixo do vídeo "${videoTitle}" e identifique TODOS os trechos que podem funcionar como clips independentes de ${minDuration}-${maxDuration} segundos.

${styleGuides[style]}

REGRAS IMPORTANTES:
- Extraia o MÁXIMO de clips possíveis, aproveitando todo o conteúdo do vídeo
- Inclua APENAS trechos que realmente funcionam — NÃO force clips fracos para aumentar a quantidade
- Cada clip DEVE ter entre ${minDuration} e ${maxDuration} segundos
- O clip deve começar com um gancho forte (frase que prende atenção nos primeiros 3 segundos)
- O clip deve ter um arco narrativo completo (início, desenvolvimento, conclusão ou cliffhanger)
- NÃO corte no meio de frases
- Cada clip deve funcionar isoladamente, sem contexto do vídeo completo
- Dê um viral_score de 1 a 10 para cada clip

TRANSCRIÇÃO:
${transcriptText}

Responda APENAS com um JSON array válido, sem markdown, sem explicações. Formato:
[
  {
    "title": "Título curto e chamativo pro clip",
    "hook": "A frase de abertura que prende atenção",
    "start_time": 123.4,
    "end_time": 178.9,
    "reason": "Por que esse trecho funciona como clip viral",
    "viral_score": 8
  }
]`;

  const text = await llm.complete(prompt);

  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const clips: ClipSuggestion[] = JSON.parse(cleaned);
    return clips.sort((a, b) => b.viral_score - a.viral_score);
  } catch (err) {
    console.error('Failed to parse LLM response:', text);
    throw new Error('Falha ao analisar resposta da IA');
  }
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
