export const FEED_DRY_STOP = 3;

const JUNK_ROLE = /(?:^|[^\p{L}\p{N}])(?:менеджер|manager|курьер|водител|риелтор|риэлтор|недвижимост|мерчендайзер|колл-?центр|коллцентр|call-?центр|контактн\p{L}* центр|кассир|продав|кладовщик|грузчик|комплектовщик|промоутер)/iu;
const STACK = /(?:^|[^\p{L}\p{N}])(?:frontend|front-end|front\s*end|фронтенд|фронтэнд|vue|react|typescript|javascript|node(?:\.?js)?|nest(?:\.?js)?|graphql|fullstack|full-stack|full\s*stack|фул+ст[еэ]к)(?=$|[^\p{L}\p{N}])/iu;

export function feedDry(title: string, text: string): boolean {
  if (JUNK_ROLE.test(title))
    return true;

  return STACK.test(`${title}\n${text}`) === false;
}

export function nextDryStreak(streak: number, title: string, text: string): number {
  if (feedDry(title, text) === false)
    return 0;

  return streak + 1;
}

export function feedEnded(streak: number): boolean {
  return streak >= FEED_DRY_STOP;
}
