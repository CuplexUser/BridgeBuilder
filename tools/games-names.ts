/**
 * Play Games achievement and leaderboard text in each language, for the Play Console's
 * translations (npm run games-ids -- --names <dir>). English is the source in
 * src/achievements.ts; the chapter ones are built from templates around the chapter's own
 * translated name. Machine-drafted, like the locale tables.
 */
import type { Lang } from '../src/i18n';

/** A name and what earns it, or for a leaderboard what it ranks. */
type Pair = readonly [name: string, how: string];

export interface GamesText {
  /** Achievements not named after a chapter, by key. */
  achievements: Record<string, Pair>;
  career: Pair;
  stars: Pair;
  /** Templates for each chapter's achievement and challenge board; {name} is the chapter. */
  chapter: Pair;
  challenge: Pair;
}

export const GAMES_TEXT: Record<Exclude<Lang, 'en'>, GamesText> = {
  de: {
    achievements: {
      first_crossing: ['Erste Überquerung', 'Überquere ein beliebiges Level.'],
      three_stars: ['Drei Sterne', 'Hol alle drei Sterne in einem Level.'],
      above_and_beyond: ['Mehr als verlangt', 'Erfülle ein Bonusziel.'],
      chief_engineer: ['Chefingenieur', 'Überquere jedes Level.'],
      perfectionist: ['Perfektionist', 'Hol drei Sterne in jedem Level.'],
      overachiever: ['Übererfüller', 'Erfülle jedes Bonusziel.'],
      back_to_the_drawing_board: ['Zurück ans Reißbrett', 'Sieh zu, wie eine deiner Brücken einstürzt.'],
      against_the_odds: ['Allen Widrigkeiten zum Trotz', 'Schließe eine Kapitel-Herausforderung ab.'],
      flawless: ['Makellos', 'Schließe eine Kapitel-Herausforderung ohne verlorenes Leben ab.'],
      architect: ['Architekt', 'Überquere ein Level, das du im Level-Editor gebaut hast.'],
    },
    career: ['Karriere', 'Die Summe deiner besten Punktzahl in jedem Level.'],
    stars: ['Sterne', 'Sterne über alle Level, Bonussterne nicht mitgezählt.'],
    chapter: ['Kapitel {name}', 'Überquere jedes Level in „{name}“.'],
    challenge: ['Herausforderung {name}', '„{name}“ am Stück, von vorn, mit drei Leben.'],
  },
  es: {
    achievements: {
      first_crossing: ['Primer cruce', 'Cruza cualquier nivel.'],
      three_stars: ['Tres estrellas', 'Consigue las tres estrellas en un nivel.'],
      above_and_beyond: ['Más allá del deber', 'Cumple un objetivo extra.'],
      chief_engineer: ['Ingeniero jefe', 'Cruza todos los niveles.'],
      perfectionist: ['Perfeccionista', 'Consigue tres estrellas en todos los niveles.'],
      overachiever: ['Sobresaliente', 'Cumple todos los objetivos extra.'],
      back_to_the_drawing_board: ['Vuelta al tablero', 'Mira cómo se derrumba uno de tus puentes.'],
      against_the_odds: ['Contra todo pronóstico', 'Termina un desafío de capítulo.'],
      flawless: ['Impecable', 'Termina un desafío de capítulo sin perder ninguna vida.'],
      architect: ['Arquitecto', 'Cruza un nivel que hayas creado en el editor de niveles.'],
    },
    career: ['Carrera', 'La suma de tu mejor puntuación en cada nivel.'],
    stars: ['Estrellas', 'Estrellas ganadas en todos los niveles, sin contar las extra.'],
    chapter: ['Capítulo {name}', 'Cruza todos los niveles de «{name}».'],
    challenge: ['Desafío {name}', '«{name}» de seguido, desde cero, con tres vidas.'],
  },
  fr: {
    achievements: {
      first_crossing: ['Première traversée', 'Traversez n’importe quel niveau.'],
      three_stars: ['Trois étoiles', 'Obtenez les trois étoiles sur un niveau.'],
      above_and_beyond: ['Au-delà du devoir', 'Atteignez un objectif bonus.'],
      chief_engineer: ['Ingénieur en chef', 'Traversez tous les niveaux.'],
      perfectionist: ['Perfectionniste', 'Obtenez trois étoiles sur tous les niveaux.'],
      overachiever: ['Premier de la classe', 'Atteignez tous les objectifs bonus.'],
      back_to_the_drawing_board: ['Retour à la planche à dessin', 'Regardez l’un de vos ponts s’effondrer.'],
      against_the_odds: ['Contre toute attente', 'Terminez un défi de chapitre.'],
      flawless: ['Sans faute', 'Terminez un défi de chapitre sans perdre de vie.'],
      architect: ['Architecte', 'Traversez un niveau créé dans l’éditeur de niveaux.'],
    },
    career: ['Carrière', 'La somme de votre meilleur score sur chaque niveau.'],
    stars: ['Étoiles', 'Étoiles gagnées sur tous les niveaux, étoiles bonus non comptées.'],
    chapter: ['Chapitre {name}', 'Traversez tous les niveaux de « {name} ».'],
    challenge: ['Défi {name}', '« {name} » d’affilée, depuis zéro, avec trois vies.'],
  },
  pl: {
    achievements: {
      first_crossing: ['Pierwsza przeprawa', 'Przejedź dowolny poziom.'],
      three_stars: ['Trzy gwiazdki', 'Zdobądź wszystkie trzy gwiazdki na poziomie.'],
      above_and_beyond: ['Ponad plan', 'Osiągnij cel dodatkowy.'],
      chief_engineer: ['Główny inżynier', 'Przejedź każdy poziom.'],
      perfectionist: ['Perfekcjonista', 'Zdobądź trzy gwiazdki na każdym poziomie.'],
      overachiever: ['Prymus', 'Osiągnij każdy cel dodatkowy.'],
      back_to_the_drawing_board: ['Wracamy do deski kreślarskiej', 'Zobacz, jak zawala się jeden z twoich mostów.'],
      against_the_odds: ['Wbrew przeciwnościom', 'Ukończ wyzwanie rozdziału.'],
      flawless: ['Bez skazy', 'Ukończ wyzwanie rozdziału bez utraty życia.'],
      architect: ['Architekt', 'Przejedź poziom stworzony w edytorze poziomów.'],
    },
    career: ['Kariera', 'Suma twoich najlepszych wyników na każdym poziomie.'],
    stars: ['Gwiazdki', 'Gwiazdki zdobyte na wszystkich poziomach, bez gwiazdek dodatkowych.'],
    chapter: ['Rozdział „{name}”', 'Przejedź każdy poziom rozdziału „{name}”.'],
    challenge: ['Wyzwanie „{name}”', '„{name}” pod rząd, od zera, z trzema życiami.'],
  },
  'pt-BR': {
    achievements: {
      first_crossing: ['Primeira travessia', 'Atravesse qualquer fase.'],
      three_stars: ['Três estrelas', 'Ganhe as três estrelas numa fase.'],
      above_and_beyond: ['Além do esperado', 'Cumpra um objetivo bônus.'],
      chief_engineer: ['Engenheiro-chefe', 'Atravesse todas as fases.'],
      perfectionist: ['Perfeccionista', 'Ganhe três estrelas em todas as fases.'],
      overachiever: ['Acima da média', 'Cumpra todos os objetivos bônus.'],
      back_to_the_drawing_board: ['De volta à prancheta', 'Veja uma das suas pontes desabar.'],
      against_the_odds: ['Contra todas as probabilidades', 'Conclua um desafio de capítulo.'],
      flawless: ['Impecável', 'Conclua um desafio de capítulo sem perder nenhuma vida.'],
      architect: ['Arquiteto', 'Atravesse uma fase que você criou no editor de fases.'],
    },
    career: ['Carreira', 'A soma da sua melhor pontuação em cada fase.'],
    stars: ['Estrelas', 'Estrelas ganhas em todas as fases, sem contar as estrelas bônus.'],
    chapter: ['Capítulo {name}', 'Atravesse todas as fases de “{name}”.'],
    challenge: ['Desafio {name}', '“{name}” direto, do zero, com três vidas.'],
  },
  sv: {
    achievements: {
      first_crossing: ['Första överfarten', 'Ta dig över valfri nivå.'],
      three_stars: ['Tre stjärnor', 'Ta alla tre stjärnorna på en nivå.'],
      above_and_beyond: ['Lite extra', 'Klara ett bonusmål.'],
      chief_engineer: ['Chefsingenjör', 'Ta dig över varje nivå.'],
      perfectionist: ['Perfektionist', 'Ta tre stjärnor på varje nivå.'],
      overachiever: ['Överpresterare', 'Klara varje bonusmål.'],
      back_to_the_drawing_board: ['Tillbaka till ritbordet', 'Se en av dina broar rasa.'],
      against_the_odds: ['Mot alla odds', 'Klara en kapitelutmaning.'],
      flawless: ['Felfritt', 'Klara en kapitelutmaning utan att förlora ett liv.'],
      architect: ['Arkitekt', 'Ta dig över en nivå du gjort i nivåeditorn.'],
    },
    career: ['Karriär', 'Summan av ditt bästa resultat på varje nivå.'],
    stars: ['Stjärnor', 'Stjärnor på alla nivåer, bonusstjärnor oräknade.'],
    chapter: ['Kapitel {name}', 'Ta dig över varje nivå i ”{name}”.'],
    challenge: ['Utmaning {name}', '”{name}” i ett svep, från början, med tre liv.'],
  },
  ru: {
    achievements: {
      first_crossing: ['Первая переправа', 'Пройдите любой уровень.'],
      three_stars: ['Три звезды', 'Получите все три звезды на уровне.'],
      above_and_beyond: ['Сверх плана', 'Выполните бонусную цель.'],
      chief_engineer: ['Главный инженер', 'Пройдите все уровни.'],
      perfectionist: ['Перфекционист', 'Получите три звезды на каждом уровне.'],
      overachiever: ['Отличник', 'Выполните все бонусные цели.'],
      back_to_the_drawing_board: ['Назад к чертежам', 'Посмотрите, как рушится один из ваших мостов.'],
      against_the_odds: ['Вопреки всему', 'Завершите испытание главы.'],
      flawless: ['Безупречно', 'Завершите испытание главы, не потеряв ни одной жизни.'],
      architect: ['Архитектор', 'Пройдите уровень, созданный в редакторе уровней.'],
    },
    career: ['Карьера', 'Сумма ваших лучших очков на каждом уровне.'],
    stars: ['Звёзды', 'Звёзды на всех уровнях, без бонусных.'],
    chapter: ['Глава «{name}»', 'Пройдите все уровни главы «{name}».'],
    challenge: ['Испытание «{name}»', '«{name}» подряд, с нуля, с тремя жизнями.'],
  },
  ja: {
    achievements: {
      first_crossing: ['はじめての橋', 'いずれかのステージを渡る。'],
      three_stars: ['星3つ', 'ステージで星を3つすべて獲得する。'],
      above_and_beyond: ['期待以上', 'ボーナス目標を達成する。'],
      chief_engineer: ['主任エンジニア', 'すべてのステージを渡る。'],
      perfectionist: ['完璧主義者', 'すべてのステージで星を3つ獲得する。'],
      overachiever: ['優等生', 'すべてのボーナス目標を達成する。'],
      back_to_the_drawing_board: ['設計からやり直し', '自分の橋が崩壊するのを見届ける。'],
      against_the_odds: ['逆境に打ち勝つ', '章チャレンジを完了する。'],
      flawless: ['ノーミス', 'ライフを失わずに章チャレンジを完了する。'],
      architect: ['建築家', 'ステージエディターで作ったステージを渡る。'],
    },
    career: ['キャリア', '各ステージのベストスコアの合計。'],
    stars: ['星', '全ステージで獲得した星の数（ボーナスの星は除く）。'],
    chapter: ['章「{name}」', '「{name}」のすべてのステージを渡る。'],
    challenge: ['チャレンジ「{name}」', '「{name}」を連続で、ゼロから、ライフ3つで。'],
  },
};
