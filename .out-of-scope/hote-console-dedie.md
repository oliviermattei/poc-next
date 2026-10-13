# Hôte console dédié

**Decision:** La console reste un chemin (`/console`) de l'hôte de l'application, avec la session de l'application. Pas de `CONSOLE_HOST`, pas de session propre à la console.

**Reason:** Reporté par le porteur le 27/09 (PRD, ligne Déploiement : « Un hôte console dédié (s65) reste reporté »), à reprendre seulement si un projet réel demande une isolation de la console. Un hôte console n'isole rien s'il ne sert que les écrans. Il exige aussi :
- son propre écran de connexion ;
- l'API d'authentification et l'API d'administration servies sur cet hôte seulement ;
- une instance d'authentification sur deux origines, avec deux cookies de session ;
- un jeton de transfert pour l'emprunt de session ;
- des passkeys multi-origines.

C'est une complexité 5 à découper, avec le risque d'un second adaptateur d'authentification (ADR 008). Le mode deux hôtes dont il dépend n'a pas encore été joué en production (#73). En attendant, la console reste fermée à tout non-superadmin, qui reçoit une 404 (ADR 068).

**Prior requests:** #183 (story s65)
