import {activeBaseMaterial} from '../../src/areas/retired-studio';
describe('Retirada de metodologia legada',()=>{
  it('isola somente os materiais antigos em áreas migradas',()=>{
    for(const file of ["ADAPTACAO-NIVOO.md","COMO-INTERAGIR-COM-O-RESPONSAVEL.md","NIVOO-REGRAS.md","README.md","architecture-baseline.md","architecture-blueprint.md","capability-contract.md","doctrine/disciplines/architecture.md","doctrine/disciplines/domain.md","doctrine/disciplines/security.md","doctrine/disciplines/testing.md","doctrine/disciplines/visual-interface-quality.md","doctrine/engineering-doctrine.md","framework.md","prompt-alinhamento.md","shared/consuming-system-adoption.md","shared/system-change-base.md","specialty-creation.md","system-remodeling.md"]){expect(activeBaseMaterial(file,true)).toBe(false);expect(activeBaseMaterial(file,false)).toBe(true);}
    expect(activeBaseMaterial('regra-cliente.md',true)).toBe(true);
    expect(activeBaseMaterial('docs/arquitetura.md',true)).toBe(true);
  });
});
