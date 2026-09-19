// Wire protocol constants shared by server and client.

export const S2C = {
  WELCOME: 'welcome',
  LOBBY: 'lobby',
  MATCH: 'match',          // you've been placed in / removed from a match
  SNAP: 'snap',            // authoritative snapshot + batched events
  ERROR: 'error',
  PONG: 'pong'
};

export const C2S = {
  HELLO: 'hello',          // { name, tankId }
  CREATE: 'create',        // { name }
  JOIN: 'join',            // { matchId, tankId }
  LEAVE: 'leave',
  START: 'start',
  SELECT_TANK: 'selectTank', // { tankId }
  INPUT: 'input',          // { fwd, steer, brake, ty, el, fire }
  RELOAD: 'reload',
  PING: 'ping'             // { t }
};

export const EVT = {
  SHOT: 'shot',
  IMPACT: 'impact',
  HIT: 'hit',
  KILL: 'kill',
  DEATH: 'death',
  RESPAWN: 'respawn',
  MATCH_START: 'matchStart',
  MATCH_END: 'matchEnd',
  COUNTDOWN: 'countdown',
  MSG: 'msg',
  JOIN: 'join',
  LEAVE: 'leave',
  RELOADED: 'reloaded'
};

export const STATUS = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ACTIVE: 'active',
  ENDED: 'ended'
};

// Snapshot tank field order (payload is a compact array for bandwidth).
export const TANK_FIELD = 'id,name,team,tankId,x,y,z,yaw,turretYaw,elev,speed,hp,alive,respawnT,reloadPct,canFire,tr,en,tu,cn,kills,deaths'.split(',');

// Server heartbeat / tick.
export const TICK_DEFAULT = 30;

export default { S2C, C2S, EVT, STATUS, TANK_FIELD };