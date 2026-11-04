import {writeFileSync} from 'node:fs';
import {sampleRoute} from './route-audit.mjs';
import {DEPOT_RULES, nextDepotAfter, depotApproachMeters, depotEntryAllowed} from '../src/game/core/depots.js';
import {hazardGeometry, HAZARD_ROW_ENVELOPE_PX} from '../src/game/core/hazards.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {routeSpeedAtDistance, METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {advanceSteering} from '../src/game/core/steering.js';
import {WORST_CASE_HANDLING} from '../src/game/core/modules.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

const seeds = [1, 153, 1234, 98765, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];
const summary = {seeds, configurations: [], overlapFailures: [], steeringFailures: [], checkedHazards: 0, checkedDepots: 0, steeringCases: 0};
for (const level of ['level1', 'level2']) for (const [mode, start, end] of ((route) => [['normal', 9, route.finishDistanceMeters],
  ['normal', route.sectorStartsMeters[GAME_BALANCE.progression.checkpointSector - 1], route.finishDistanceMeters],
  ...(level === 'level1' ? [['continuous', GAME_BALANCE.routes.spawning.initialRowDelaySeconds *
    routeSpeedAtDistance(0, level, 'continuous') * METERS_PER_PIXEL, 12000]] : [])])(GAME_BALANCE.routes[level])) {
  for (const enter of [false,true]) {
    const config = {level,mode,start,end,enter,depots:0,hazards:0};
    for (const seed of seeds) {
      const groups = sampleRoute(seed,end,enter,level,mode,start);
      const bays=[];
      for(let bay=nextDepotAfter(start,DEPOT_RULES,level,mode);bay.distance<end;bay=nextDepotAfter(bay.distance,DEPOT_RULES,level,mode)) bays.push(bay);
      config.depots+=bays.length;
      for(const row of groups.filter(row=>row.emitted)) for(const h of [...row.hazards,...row.intermediates].filter(h=>!h.continuation)) {
        const envelope=Math.max(HAZARD_ROW_ENVELOPE_PX/2,hazardGeometry(h).hitY);
        const first=row.spawnDistance+(HAZARD_TRAVEL_PX-h.offsetY-envelope)*METERS_PER_PIXEL;
        const last=row.spawnDistance+(HAZARD_TRAVEL_PX-h.offsetY+envelope)*METERS_PER_PIXEL;
        config.hazards++;
        for(const bay of bays) if(first<=bay.distance+DEPOT_RULES.exitMeters && last>=bay.distance-depotApproachMeters(bay.distance,level,mode)) summary.overlapFailures.push({level,mode,start,enter,seed,bay:bay.distance,kind:h.kind,first,last});
      }
    }
    summary.checkedHazards+=config.hazards;
    summary.checkedDepots+=config.depots;
    summary.configurations.push(config);
  }
  // Simulate the real steering model from the opposite road edge, fully loaded,
  // after a 350 ms reaction delay. Test both entrance sides and frame rates.
  for(let bay=nextDepotAfter(start,DEPOT_RULES,level,mode);bay.distance<end;bay=nextDepotAfter(bay.distance,DEPOT_RULES,level,mode)) {
    for(const hz of [30,60,120]) for(const handling of [WORST_CASE_HANDLING,0,0.32]) for(const side of ['left','right']) {
      const targetX=side==='left'?73:317;
      let state={x:side==='left'?317:73,velocity:0};
      let distance=bay.distance-depotApproachMeters(bay.distance,level,mode);
      let elapsed=0,entered=false;
      let priorDistance=distance;
      while(distance<=bay.distance+DEPOT_RULES.triggerHalfMeters) {
        const dt=1/hz;
        if(elapsed>=0.35) state=advanceSteering({...state,targetX,dt,minX:73,maxX:317,load:32,capacity:32,handling,loadRelief:0});
        if(depotEntryAllowed({...bay,side},distance,state.x,priorDistance)) entered=true;
        priorDistance=distance;
        distance+=routeSpeedAtDistance(distance,level,mode)*METERS_PER_PIXEL*dt;
        elapsed+=dt;
      }
      summary.steeringCases++;
      if(!entered) summary.steeringFailures.push({level,mode,start,bay:bay.distance,hz,handling,side,finalX:state.x});
    }
  }
}
writeFileSync('depot-verification-results.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,configurations:summary.configurations.length,overlapFailures:summary.overlapFailures.slice(0,8),overlapFailureCount:summary.overlapFailures.length,steeringFailures:summary.steeringFailures.slice(0,8),steeringFailureCount:summary.steeringFailures.length},null,2));
if(summary.overlapFailures.length||summary.steeringFailures.length)process.exitCode=1;
