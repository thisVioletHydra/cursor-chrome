import { detectWall } from './src/hh/detect-wall.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const WALL = 'Вам недоступна эта вакансия. Войдите как пользователь, у которого есть доступ на просмотр, либо как работодатель, создавший эту вакансию.';

test('the closed vacancy wall is a detect alarm, a normal card is not', () => {
  assert.equal(detectWall(WALL), true);
  assert.equal(detectWall('Поиск работы Дальше Войти с паролем'), false);
  assert.equal(detectWall('Frontend-разработчик Откликнуться'), false);
});
