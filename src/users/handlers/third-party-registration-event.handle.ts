import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { ThirdPartyRegistrationEvent } from '../events/third-party-registration.event';
import { UserCredentialsService } from '../services/user-credential.service';
import { CreateCredentialDTO } from '../model/dto/create-credential.dto';
import { StoreCategory } from '../../stores/model/enums/store.category';

@EventsHandler()
export class ThirdPartyRegistrationEventHandler
  implements IEventHandler<ThirdPartyRegistrationEvent>
{
  constructor(private readonly userCredentialService: UserCredentialsService) {}
  handle(event: ThirdPartyRegistrationEvent) {
    const { userId, cacURL } = event;
    const credential = new CreateCredentialDTO();
    credential.cacURL = cacURL;
    credential.vendorCategory = StoreCategory.OTHER;
    return this.userCredentialService.create(credential);
  }
}
