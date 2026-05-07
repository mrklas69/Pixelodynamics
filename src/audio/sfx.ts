// Audio efekty — pool HTMLAudioElement instancí pro overlapping plays.
//
// Důvod poolu: jediný Audio element neumí hrát stejný zvuk dvakrát překrývajícím se
// způsobem (volání .play() během přehrávání restartuje). Pro joint create/break v
// rychlém sledu (například při hromadném rozpadu) potřebujeme nezávislé instance.
//
// Browser autoplay policy: první play vyžaduje user gesture (LMB klik, klávesnice).
// V Pixelodynamics user iniciuje akce kliknutím, takže gesture je vždy splněn před
// prvním přehráním. Pokud ne (auto-stop modelshot bez interakce), .play() Promise
// se rejectne a my to tichne polkneme.

import clickUrl from '../assets/click.mp3';
import spawnUrl from '../assets/spawn.mp3';

const POOL_SIZE = 5;
const VOLUME = 0.4;

type Pool = { instances: HTMLAudioElement[]; cursor: number };

const pools = new Map<string, Pool>();

function getOrInit(url: string): Pool {
  let pool = pools.get(url);
  if (pool) return pool;
  const instances: HTMLAudioElement[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const a = new Audio(url);
    a.volume = VOLUME;
    a.preload = 'auto';
    instances.push(a);
  }
  pool = { instances, cursor: 0 };
  pools.set(url, pool);
  return pool;
}

function play(url: string): void {
  const pool = getOrInit(url);
  const a = pool.instances[pool.cursor]!;
  pool.cursor = (pool.cursor + 1) % POOL_SIZE;
  a.currentTime = 0;
  void a.play().catch(() => {
    // Autoplay blocked nebo audio decode fail — tiše ignorujeme, není to kritická cesta.
  });
}

/**
 * Strukturální event slepování / rozpadu (joint create + remove).
 * Stejný zvuk pro oba — symetrie eventů.
 */
export function playClick(): void {
  play(clickUrl);
}

/** Spawn nového pixelu (LMB klik). */
export function playSpawn(): void {
  play(spawnUrl);
}
