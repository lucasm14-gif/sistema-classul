import React, { useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, Circle, Volume2 } from 'lucide-react';
import { Panel } from '../ui';
import { toDate, startOfDay } from '../analytics';

// Área Estudos do app (chinês e ENEM 2027), só para acompanhar: as aulas são
// escritas pelo Hermes quando o Lucas abre o tema no iPhone e chegam aqui pelo snapshot.

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const TRACKS = [
  ['chines', 'Chinês'],
  ['enem', 'ENEM 2027']
];
const dm = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

// **negrito** e listas com "- ", sem HTML cru.
function Rich({ text }) {
  const inline = (line, k) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <b key={`${k}-${i}`}>{part.slice(2, -2)}</b> : <React.Fragment key={`${k}-${i}`}>{part}</React.Fragment>
    );
  const blocks = [];
  let list = null;
  String(text || '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trimEnd();
      if (/^\s*[-•]\s+/.test(line)) {
        if (!list) blocks.push((list = { type: 'ul', items: [] }));
        list.items.push(inline(line.replace(/^\s*[-•]\s+/, ''), i));
      } else {
        list = null;
        if (line.trim()) blocks.push({ type: 'p', content: inline(line, i) });
      }
    });
  return (
    <div className="idl-rich">
      {blocks.map((b, i) =>
        b.type === 'ul' ? (
          <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
        ) : (
          <p key={i}>{b.content}</p>
        )
      )}
    </div>
  );
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.8;
  window.speechSynthesis.speak(u);
}

function LessonPanel({ topic, lesson }) {
  const content = parse(lesson?.lesson);
  const chat = parse(lesson?.chat) || [];
  if (!topic) return <Panel title="Aula"><p className="idl-empty">Escolha um tema ao lado para ler a aula.</p></Panel>;
  return (
    <Panel
      title={topic.area}
      right={lesson?.completedAt ? <span className="idl-study-done">Concluída {dm(toDate(lesson.completedAt))}</span> : lesson ? <span className="idl-mono">em andamento</span> : null}
      className="idl-study-lesson"
    >
      <h2>{content?.titulo || topic.title}</h2>
      {content?.resumo && <p className="idl-study-sum">{content.resumo}</p>}
      {!content && <p className="idl-empty">{lesson ? 'A aula ainda não chegou do Hermes.' : 'Ainda não aberta no iPhone. Quando ele abrir o tema, o Hermes escreve a aula e ela aparece aqui.'}</p>}
      {lesson?.answered > 0 && (
        <p className="idl-note">
          Questões: {lesson.correct} de {lesson.answered} certas ({Math.round((lesson.correct / lesson.answered) * 100)}%)
        </p>
      )}
      {(content?.secoes || []).map((s, i) => (
        <section key={i} className="idl-study-sec">
          <h4><span>{String(i + 1).padStart(2, '0')}</span> {s.titulo}</h4>
          <Rich text={s.texto} />
        </section>
      ))}
      {!!content?.vocab?.length && (
        <section className="idl-study-sec">
          <h4>Vocabulário</h4>
          <div className="idl-vocab">
            {content.vocab.map((w) => (
              <button key={w.hanzi} onClick={() => speak(w.hanzi)} title="Ouvir">
                <b>{w.hanzi}</b>
                <span>{w.pinyin}</span>
                <small>{w.pt}</small>
                <Volume2 size={12} />
              </button>
            ))}
          </div>
        </section>
      )}
      {!!content?.dicas?.length && (
        <section className="idl-study-sec">
          <h4>{topic.track === 'enem' ? 'No ENEM' : 'Dicas'}</h4>
          <ul className="idl-study-tips">{content.dicas.map((d, i) => <li key={i}><Rich text={d} /></li>)}</ul>
        </section>
      )}
      {!!chat.length && (
        <section className="idl-study-sec">
          <h4>Dúvidas</h4>
          {chat.map((t, i) => (
            <div key={i} className="idl-study-qa">
              <p className="q">{t.p}</p>
              <Rich text={t.r} />
            </div>
          ))}
        </section>
      )}
    </Panel>
  );
}

export default function Study({ raw }) {
  const study = raw.study;
  const [track, setTrack] = useState('chines');
  const [sel, setSel] = useState(null);

  const data = useMemo(() => {
    if (!study) return null;
    const byTopic = new Map((study.lessons || []).map((l) => [l.topicID, l]));
    const topics = study.topics || [];
    const tracks = Object.fromEntries(
      TRACKS.map(([id]) => {
        const list = topics.filter((t) => t.track === id);
        const areas = [...new Set(list.map((t) => t.area))].map((area) => {
          const ts = list.filter((t) => t.area === area);
          return { area, topics: ts, done: ts.filter((t) => byTopic.get(t.id)?.completedAt).length };
        });
        return [id, { topics: list, areas, done: list.filter((t) => byTopic.get(t.id)?.completedAt).length }];
      })
    );
    const lessons = study.lessons || [];
    const answered = lessons.reduce((s, l) => s + (l.answered || 0), 0);
    const correct = lessons.reduce((s, l) => s + (l.correct || 0), 0);
    const now = Date.now() / 1000;
    const cards = [...(study.cards || [])].sort((a, b) => a.due - b.due);
    const today = startOfDay(new Date());
    const enem = toDate(study.enemDate);
    const recent = lessons.filter((l) => l.completedAt).sort((a, b) => b.completedAt - a.completedAt).slice(0, 6);
    return {
      byTopic,
      tracks,
      answered,
      correct,
      cards,
      due: cards.filter((c) => c.due <= now).length,
      daysToEnem: Math.max(0, Math.round((startOfDay(enem) - today) / 86400000)),
      enem,
      recent,
      topicById: new Map(topics.map((t) => [t.id, t]))
    };
  }, [study]);

  if (!data) {
    return <p className="idl-empty center">Atualize o Ideal no iPhone para os estudos aparecerem aqui.</p>;
  }

  const cur = data.tracks[track];
  const next = cur.topics.find((t) => !data.byTopic.get(t.id)?.completedAt);
  const selTopic = (sel && data.topicById.get(sel)) || next || null;
  const pct = (n, d) => `${Math.round((n / Math.max(d, 1)) * 100)}%`;

  return (
    <div className="idl-study">
      <div className="idl-study-stats">
        <Panel title="Chinês">
          <p className="idl-big">{data.tracks.chines.done}<small>/{data.tracks.chines.topics.length}</small></p>
          <div className="idl-meter"><i style={{ width: pct(data.tracks.chines.done, data.tracks.chines.topics.length) }} /></div>
          <p className="idl-note">aulas concluídas</p>
        </Panel>
        <Panel title="ENEM 2027">
          <p className="idl-big">{data.tracks.enem.done}<small>/{data.tracks.enem.topics.length}</small></p>
          <div className="idl-meter"><i style={{ width: pct(data.tracks.enem.done, data.tracks.enem.topics.length) }} /></div>
          <p className="idl-note">faltam <b>{data.daysToEnem}</b> dias · prova prevista {data.enem.toLocaleDateString('pt-BR')}</p>
        </Panel>
        <Panel title="Questões">
          <p className="idl-big">{data.answered ? pct(data.correct, data.answered) : '—'}</p>
          <p className="idl-note">{data.correct} certas de {data.answered} feitas</p>
        </Panel>
        <Panel title="Cartões">
          <p className="idl-big">{data.cards.length}</p>
          <p className="idl-note">{data.due ? `${data.due} para revisar hoje` : 'nada para revisar hoje'}</p>
        </Panel>
      </div>

      <div className="idl-study-main">
        <div className="idl-study-side">
          <div className="idl-seg">
            {TRACKS.map(([id, label]) => (
              <button key={id} className={track === id ? 'on' : ''} onClick={() => { setTrack(id); setSel(null); }}>
                {label}
              </button>
            ))}
          </div>
          {cur.areas.map((a) => (
            <Panel key={a.area} title={a.area} right={<span className="idl-mono">{a.done}/{a.topics.length}</span>}>
              <div className="idl-meter thin"><i style={{ width: pct(a.done, a.topics.length) }} /></div>
              <ul className="idl-topics">
                {a.topics.map((t, i) => {
                  const l = data.byTopic.get(t.id);
                  const Icon = l?.completedAt ? CheckCircle2 : l?.lesson ? CircleDashed : Circle;
                  return (
                    <li key={t.id}>
                      <button className={`${selTopic?.id === t.id ? 'on' : ''} ${l?.completedAt ? 'done' : ''}`} onClick={() => setSel(t.id)}>
                        <span className="idl-mono">{String(i + 1).padStart(2, '0')}</span>
                        <Icon size={14} className="ic" />
                        <span className="t">{t.title}</span>
                        {next?.id === t.id && <em>próxima</em>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>

        <div className="idl-study-content">
          <LessonPanel topic={selTopic} lesson={selTopic ? data.byTopic.get(selTopic.id) : null} />
          {track === 'chines' && (
            <Panel title="Cartões de vocabulário" right={<span className="idl-mono">{data.cards.length}</span>}>
              {!data.cards.length && <p className="idl-empty">Ao concluir uma aula de chinês no iPhone, as palavras novas viram cartões.</p>}
              {!!data.cards.length && (
                <table className="idl-table idl-cards">
                  <thead>
                    <tr><th>Caractere</th><th>Pinyin</th><th>Significado</th><th>Caixa</th><th>Revisar</th></tr>
                  </thead>
                  <tbody>
                    {data.cards.map((c) => {
                      const d = toDate(c.due);
                      return (
                        <tr key={c.hanzi} onClick={() => speak(c.hanzi)} title="Ouvir">
                          <td className="hz">{c.hanzi}</td>
                          <td>{c.pinyin}</td>
                          <td>{c.meaning}</td>
                          <td className="idl-mono">{c.box}</td>
                          <td className="idl-mono">{d <= new Date() ? 'hoje' : dm(d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
          {!!data.recent.length && (
            <Panel title="Concluídas por último">
              <ul className="idl-study-recent">
                {data.recent.map((l) => {
                  const t = data.topicById.get(l.topicID);
                  return (
                    <li key={l.topicID}>
                      <button onClick={() => { setTrack(t?.track || track); setSel(l.topicID); }}>
                        <span>{t?.title || l.topicID}</span>
                        <small>{t?.track === 'enem' ? `ENEM · ${t.area}` : 'Chinês'} · {dm(toDate(l.completedAt))}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
