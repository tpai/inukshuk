// ?debug panel: scrub time, season, age; summon birds and gusts; show physics and bones.

import { h } from './app';
import { debug, triggerGust, type Season } from './env';

export function mountDebug(summonBird: () => void) {
  const out = (v: string) => h('output', {}, v);

  const hourOut = out('real');
  const hour = h('input', { type: 'range', min: '0', max: '24', step: '0.1', value: '12', disabled: true });
  const hourReal = h('input', { type: 'checkbox', checked: true });
  const syncHour = () => {
    hour.disabled = hourReal.checked;
    debug.hour = hourReal.checked ? null : Number(hour.value);
    hourOut.textContent = hourReal.checked ? 'real' : Number(hour.value).toFixed(1) + 'h';
  };
  hour.addEventListener('input', syncHour);
  hourReal.addEventListener('change', syncHour);

  const ageOut = out('real');
  const age = h('input', { type: 'range', min: '0', max: '400', step: '0.5', value: '0', disabled: true });
  const ageReal = h('input', { type: 'checkbox', checked: true });
  const syncAge = () => {
    age.disabled = ageReal.checked;
    debug.ageDays = ageReal.checked ? null : Number(age.value);
    ageOut.textContent = ageReal.checked ? 'real' : age.value + 'd';
  };
  age.addEventListener('input', syncAge);
  ageReal.addEventListener('change', syncAge);

  const season = h('select', {},
    ...['auto', 'spring', 'summer', 'autumn', 'winter'].map((s) => h('option', { value: s }, s)),
  );
  season.addEventListener('change', () => (debug.season = season.value === 'auto' ? null : (season.value as Season)));

  const hemi = h('select', {}, ...['auto', 'north', 'south'].map((s) => h('option', { value: s }, s)));
  hemi.addEventListener('change', () => (debug.hemisphere = hemi.value === 'auto' ? null : (hemi.value as 'north' | 'south')));

  const animal = h('select', {}, ...['auto', 'idle', 'walk', 'run', 'sleep'].map((s) => h('option', { value: s }, s)));
  animal.addEventListener('change', () => (debug.animalState = animal.value === 'auto' ? null : (animal.value as 'idle')));

  const check = (label: string, key: 'showColliders' | 'showBones') => {
    const c = h('input', { type: 'checkbox' });
    c.addEventListener('change', () => (debug[key] = c.checked));
    return h('label.row', {}, c, label);
  };

  const panel = h('details.debug', {},
    h('summary', {}, 'debug'),
    h('label.row', {}, 'hour', hourReal, 'real', hour, hourOut),
    h('label.row', {}, 'age', ageReal, 'real', age, ageOut),
    h('label.row', {}, 'season', season),
    h('label.row', {}, 'hemisphere', hemi),
    h('label.row', {}, 'animals', animal),
    h('div.row', {}, 'arrive at 1 / 7 / 30 / 90 / 180 / 360 d'),
    h('div.row', {},
      h('button', { onclick: summonBird }, 'summon bird'),
      h('button', { onclick: triggerGust }, 'gust'),
    ),
    check('colliders', 'showColliders'),
    check('bones', 'showBones'),
  );
  document.body.append(panel);
}
