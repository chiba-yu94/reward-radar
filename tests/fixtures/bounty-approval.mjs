// This sample is exclusively for local tests.
const source = 'https://make.fun/bounty/local-fixture-offline-game';
export const fixtureBounty = {
  id:'offline-game-skill-fixture',status:'approved',type:'skill-bounty',
  last_checked_at:'2026-11-25T06:00:00Z',deadline:'2026-11-26T13:37:00Z',
  deadline_timezone:'UTC',official_url:source,
  review:{accepting:true,japan_eligible:true,no_upfront_cost:true,payment_verified:true,safe_non_security:true,
    evidence_url:source},
  reward:{kind:'prize',amount:60,currency:'USD',maximum:true},
  conditions:{free:true,ai:'required',sns:false,entry_method:'public-repository',eligible_countries:['JP'],
    payment_method:'usdc-solana',requirements:['repository','transcript','offline']},
  copy:{
    ja:{title:'オフラインゲーム制作（検証用）',description:'公開リポジトリで応募する技能系バウンティの検証用データです。',
      task:'オフラインで遊べるゲームと、制作セッションの記録を公開リポジトリで提出。',
      eligibility:'日本国内在住者も応募可。',expenses:'応募料・購入は不要。',
      reward_terms:'順位条件を満たす入賞者が対象。1位は60米ドル相当。',payment:'Solana上のUSDCで支払い。',
      organizer:'検証用の主催者'},
    en:{title:'Offline game bounty (fixture)',description:'A local sample of a skill bounty that accepts public repositories.',
      task:'Submit the offline game and a build-session transcript through a public repository.',
      eligibility:'Residents of Japan may enter.',expenses:'No fee or purchase is required.',
      reward_terms:'Only qualifying ranks receive a prize. First place receives the equivalent of USD 60.',
      payment:'Payment in USDC on Solana.',organizer:'Fixture organizer'},
  },
};
export const fixturePublication = {
  listing:'quests/' + fixtureBounty.id,
  first_published_at:'2026-11-25T06:15:00Z',evidence_url:source,languages:['ja','en'],
};
