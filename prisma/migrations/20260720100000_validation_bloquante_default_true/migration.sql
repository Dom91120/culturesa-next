-- « Verrouillage des réservations validées » (services.validationBloquante) : ON par défaut.
-- On ne modifie QUE la valeur par défaut (nouveaux services). Les services existants
-- conservent leur réglage actuel — un gestionnaire a pu volontairement le désactiver.
ALTER TABLE "services" ALTER COLUMN "validationBloquante" SET DEFAULT true;
